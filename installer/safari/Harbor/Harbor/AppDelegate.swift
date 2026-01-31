//
//  AppDelegate.swift
//  Harbor
//
//  Created by Raffi Krikorian on 1/30/26.
//

import Cocoa
import os

@main
class AppDelegate: NSObject, NSApplicationDelegate {
    
    private static let log = OSLog(subsystem: "org.harbor", category: "App")
    private var bridgeProcess: Process?
    private var statusItem: NSStatusItem?
    
    // File-based logging for debugging - use /tmp to avoid sandbox issues
    private func debugLog(_ message: String) {
        let logPath = "/tmp/harbor-app.log"
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let line = "[\(timestamp)] \(message)\n"
        
        if let data = line.data(using: .utf8) {
            if FileManager.default.fileExists(atPath: logPath) {
                if let handle = FileHandle(forWritingAtPath: logPath) {
                    handle.seekToEndOfFile()
                    handle.write(data)
                    handle.closeFile()
                }
            } else {
                try? data.write(to: URL(fileURLWithPath: logPath))
            }
        }
        
        // Also print to stderr for terminal debugging
        fputs("[\(timestamp)] \(message)\n", stderr)
        
        // Also use os_log
        os_log(.info, log: Self.log, "%{public}@", message)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        debugLog("Harbor app starting...")
        debugLog("Bundle path: \(Bundle.main.bundlePath)")
        
        // Create status bar item so user knows app is running
        setupStatusBar()
        
        // Start harbor-bridge in HTTP server mode for Safari extension
        startBridgeServer()
    }
    
    func applicationWillTerminate(_ notification: Notification) {
        // Stop the bridge process when app quits
        stopBridgeServer()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // Keep app running for the HTTP server even when window is closed
        return false
    }
    
    // MARK: - Status Bar
    
    private func setupStatusBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        
        if let button = statusItem?.button {
            button.image = NSImage(systemSymbolName: "network", accessibilityDescription: "Harbor")
            button.toolTip = "Harbor - Bridge server running"
        }
        
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Harbor Bridge Running", action: nil, keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit Harbor", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        statusItem?.menu = menu
    }
    
    // MARK: - Bridge Server Management
    
    private func startBridgeServer() {
        debugLog("startBridgeServer called")
        
        guard let bridgePath = findBridgeBinary() else {
            debugLog("ERROR: harbor-bridge binary not found")
            updateStatusBar(running: false, error: "Bridge binary not found")
            return
        }
        
        debugLog("Found bridge at: \(bridgePath)")
        debugLog("File exists: \(FileManager.default.fileExists(atPath: bridgePath))")
        
        let process = Process()
        process.executableURL = URL(fileURLWithPath: bridgePath)
        process.arguments = ["--http-server"]
        
        // Let output go to inherited handles (don't redirect)
        // This avoids issues with the process crashing when pipes are closed
        
        do {
            debugLog("Attempting to run process...")
            try process.run()
            bridgeProcess = process
            debugLog("Bridge HTTP server started with PID: \(process.processIdentifier)")
            updateStatusBar(running: true, error: nil)
        } catch {
            debugLog("ERROR: Failed to start bridge: \(error.localizedDescription)")
            updateStatusBar(running: false, error: error.localizedDescription)
        }
    }
    
    private func updateStatusBar(running: Bool, error: String?) {
        if let button = statusItem?.button {
            if running {
                button.image = NSImage(systemSymbolName: "network", accessibilityDescription: "Harbor")
                button.toolTip = "Harbor - Bridge server running on port 8766"
            } else {
                button.image = NSImage(systemSymbolName: "network.slash", accessibilityDescription: "Harbor Error")
                button.toolTip = "Harbor - Bridge not running: \(error ?? "unknown error")"
            }
        }
    }
    
    private func stopBridgeServer() {
        guard let process = bridgeProcess, process.isRunning else { return }
        os_log(.info, log: Self.log, "Stopping bridge HTTP server...")
        process.terminate()
        bridgeProcess = nil
    }
    
    private func findBridgeBinary() -> String? {
        let bundle = Bundle.main
        
        // First, look in the app bundle's MacOS folder
        let bundlePath = bundle.bundlePath as NSString
        let macOSPath = bundlePath.appendingPathComponent("Contents/MacOS/harbor-bridge")
        
        debugLog("Checking for bridge at: \(macOSPath)")
        if FileManager.default.fileExists(atPath: macOSPath) {
            debugLog("Found bridge in app bundle")
            return macOSPath
        }
        
        // Fallback: development path
        let devPath = NSHomeDirectory() + "/stuff/code/harbor/bridge-rs/target/release/harbor-bridge"
        debugLog("Checking for bridge at: \(devPath)")
        if FileManager.default.fileExists(atPath: devPath) {
            debugLog("Found bridge in dev path")
            return devPath
        }
        
        debugLog("Bridge binary not found in any location")
        return nil
    }
}

