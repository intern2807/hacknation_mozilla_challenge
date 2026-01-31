//
//  SafariWebExtensionHandler.swift
//  Harbor Extension
//
//  Native messaging handler that spawns harbor-bridge as a subprocess
//  and relays messages between the Safari extension and the bridge.
//

import SafariServices
import os

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    
    private static let log = OSLog(subsystem: "org.harbor.extension", category: "NativeMessaging")
    
    // File-based logging for debugging (Safari's console can be hard to access)
    private static func debugLog(_ message: String) {
        os_log(.info, log: log, "%{public}@", message)
        
        // Also write to a file for easier debugging
        let logFile = NSHomeDirectory() + "/Library/Caches/harbor-safari-handler.log"
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let logLine = "[\(timestamp)] \(message)\n"
        
        if let data = logLine.data(using: .utf8) {
            if FileManager.default.fileExists(atPath: logFile) {
                if let handle = FileHandle(forWritingAtPath: logFile) {
                    handle.seekToEndOfFile()
                    handle.write(data)
                    handle.closeFile()
                }
            } else {
                FileManager.default.createFile(atPath: logFile, contents: data, attributes: nil)
            }
        }
    }
    
    // Persistent bridge process for the extension lifetime
    private static var bridgeProcess: Process?
    private static var bridgeStdin: FileHandle?
    private static var bridgeStdout: FileHandle?
    private static let queue = DispatchQueue(label: "org.harbor.bridge", qos: .userInitiated)
    
    func beginRequest(with context: NSExtensionContext) {
        Self.debugLog("=== beginRequest called! ===")
        
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey]
        
        Self.debugLog("Received message: \(String(describing: message))")
        Self.debugLog("Message type: \(type(of: message))")
        
        guard let messageDict = message as? [String: Any] else {
            os_log(.error, log: Self.log, "Invalid message format - expected dictionary")
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: ["error": "Invalid message format"]]
            context.completeRequest(returningItems: [response], completionHandler: nil)
            return
        }
        
        // Handle the message on a background queue
        Self.queue.async {
            do {
                let response = try self.handleMessageSync(messageDict)
                let responseItem = NSExtensionItem()
                responseItem.userInfo = [SFExtensionMessageKey: response]
                context.completeRequest(returningItems: [responseItem], completionHandler: nil)
            } catch {
                os_log(.error, log: Self.log, "Error handling message: %{public}@", error.localizedDescription)
                let responseItem = NSExtensionItem()
                responseItem.userInfo = [SFExtensionMessageKey: ["error": error.localizedDescription]]
                context.completeRequest(returningItems: [responseItem], completionHandler: nil)
            }
        }
    }
    
    private func handleMessageSync(_ message: [String: Any]) throws -> [String: Any] {
        Self.debugLog("handleMessageSync: ensuring bridge is running...")
        
        // Ensure bridge is running (this is thread-safe via the serial queue)
        try Self.ensureBridgeRunning()
        
        Self.debugLog("handleMessageSync: bridge is running, preparing message...")
        
        // Convert message to JSON and send to bridge
        let jsonData = try JSONSerialization.data(withJSONObject: message, options: [])
        
        // Native messaging protocol: 4-byte length prefix (little-endian) + JSON
        var length = UInt32(jsonData.count).littleEndian
        var messageData = Data(bytes: &length, count: 4)
        messageData.append(jsonData)
        
        guard let stdin = Self.bridgeStdin else {
            Self.debugLog("handleMessageSync: ERROR - stdin is nil")
            throw BridgeError.notConnected
        }
        
        // Send the message
        Self.debugLog("handleMessageSync: sending \(messageData.count) bytes to bridge...")
        try stdin.write(contentsOf: messageData)
        Self.debugLog("handleMessageSync: message sent, reading response...")
        
        // Read the response
        let response = try readResponseSync()
        Self.debugLog("handleMessageSync: got response with \(response.count) keys")
        return response
    }
    
    private func readResponseSync() throws -> [String: Any] {
        Self.debugLog("readResponseSync: starting...")
        
        guard let stdout = Self.bridgeStdout else {
            Self.debugLog("readResponseSync: ERROR - stdout is nil")
            throw BridgeError.notConnected
        }
        
        // Read length prefix (4 bytes, little-endian)
        Self.debugLog("readResponseSync: reading length prefix...")
        guard let lengthData = try stdout.read(upToCount: 4), lengthData.count == 4 else {
            Self.debugLog("readResponseSync: ERROR - failed to read length prefix")
            throw BridgeError.invalidResponse
        }
        
        let length = lengthData.withUnsafeBytes { $0.load(as: UInt32.self).littleEndian }
        Self.debugLog("readResponseSync: expecting \(length) bytes of response")
        
        guard length > 0 && length < 10_000_000 else {  // Sanity check: max 10MB
            Self.debugLog("readResponseSync: ERROR - invalid length: \(length)")
            throw BridgeError.invalidResponse
        }
        
        // Read the JSON response
        var responseData = Data()
        while responseData.count < length {
            let remaining = Int(length) - responseData.count
            guard let chunk = try stdout.read(upToCount: remaining), !chunk.isEmpty else {
                Self.debugLog("readResponseSync: ERROR - failed to read chunk")
                throw BridgeError.invalidResponse
            }
            responseData.append(chunk)
        }
        
        Self.debugLog("readResponseSync: read \(responseData.count) bytes, parsing JSON...")
        
        guard let response = try JSONSerialization.jsonObject(with: responseData) as? [String: Any] else {
            Self.debugLog("readResponseSync: ERROR - failed to parse JSON")
            throw BridgeError.invalidResponse
        }
        
        Self.debugLog("readResponseSync: success!")
        return response
    }
    
    private static var lastSearchedPaths: [String] = []
    
    private static func ensureBridgeRunning() throws {
        // Check if already running
        if let process = bridgeProcess, process.isRunning {
            return
        }
        
        // Find the harbor-bridge binary in the app bundle
        guard let bridgePath = findBridgeBinary() else {
            os_log(.error, log: log, "harbor-bridge binary not found in app bundle")
            // Include searched paths in error for debugging
            let pathsInfo = lastSearchedPaths.joined(separator: "; ")
            throw BridgeError.binaryNotFoundWithPaths(pathsInfo)
        }
        
        debugLog("Starting harbor-bridge at: \(bridgePath)")
        
        let process = Process()
        process.executableURL = URL(fileURLWithPath: bridgePath)
        process.arguments = ["--native-messaging"]
        
        debugLog("Process configured, about to run...")
        
        // Set up pipes for stdin/stdout
        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe
        
        // Log stderr output
        stderrPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty, let str = String(data: data, encoding: .utf8) {
                os_log(.default, log: Self.log, "Bridge stderr: %{public}@", str)
            }
        }
        
        // Handle process termination
        process.terminationHandler = { proc in
            os_log(.info, log: Self.log, "Bridge process terminated with status: %d", proc.terminationStatus)
            Self.queue.async {
                Self.bridgeProcess = nil
                Self.bridgeStdin = nil
                Self.bridgeStdout = nil
            }
        }
        
        do {
            try process.run()
            debugLog("Process started with PID: \(process.processIdentifier)")
        } catch {
            debugLog("Failed to start process: \(error.localizedDescription)")
            throw error
        }
        
        bridgeProcess = process
        bridgeStdin = stdinPipe.fileHandleForWriting
        bridgeStdout = stdoutPipe.fileHandleForReading
        
        debugLog("Bridge process running, stdin/stdout connected")
    }
    
    private static func findBridgeBinary() -> String? {
        // Track searched paths for error reporting
        lastSearchedPaths = []
        
        // Use Bundle(for:) to get the extension's bundle reliably
        let extensionBundle = Bundle(for: SafariWebExtensionHandler.self)
        let bundlePath = extensionBundle.bundlePath
        
        // First try: Look in the extension's own Resources folder (sandbox-accessible)
        if let resourcePath = extensionBundle.path(forResource: "harbor-bridge", ofType: nil) {
            debugLog("Found in extension Resources: \(resourcePath)")
            lastSearchedPaths.append("extResources=\(resourcePath)")
            return resourcePath
        }
        
        // Second try: Look in the extension bundle's MacOS folder
        let extMacOSPath = (bundlePath as NSString).appendingPathComponent("Contents/MacOS/harbor-bridge")
        lastSearchedPaths.append("extMacOS=\(extMacOSPath)")
        if FileManager.default.fileExists(atPath: extMacOSPath) {
            debugLog("Found in extension MacOS: \(extMacOSPath)")
            return extMacOSPath
        }
        
        // Third try: Navigate from extension to main app bundle
        // Extension path: .../Harbor.app/Contents/PlugIns/Harbor Extension.appex/
        // Target path: .../Harbor.app/Contents/MacOS/harbor-bridge
        let nsPath = bundlePath as NSString
        let plugInsPath = nsPath.deletingLastPathComponent
        let contentsPath = (plugInsPath as NSString).deletingLastPathComponent
        let mainAppBridgePath = (contentsPath as NSString).appendingPathComponent("MacOS/harbor-bridge")
        
        lastSearchedPaths.append("mainApp=\(mainAppBridgePath)")
        
        if FileManager.default.fileExists(atPath: mainAppBridgePath) {
            debugLog("Found in main app: \(mainAppBridgePath)")
            return mainAppBridgePath
        }
        
        debugLog("harbor-bridge not found in any location")
        return nil
    }
}

enum BridgeError: LocalizedError {
    case binaryNotFound
    case binaryNotFoundWithPaths(String)
    case notConnected
    case invalidResponse
    case timeout
    
    var errorDescription: String? {
        switch self {
        case .binaryNotFound:
            return "harbor-bridge binary not found. Ensure it's bundled in the app."
        case .binaryNotFoundWithPaths(let paths):
            return "harbor-bridge not found. Searched: \(paths)"
        case .notConnected:
            return "Not connected to harbor-bridge"
        case .invalidResponse:
            return "Invalid response from harbor-bridge"
        case .timeout:
            return "Request timed out"
        }
    }
}
