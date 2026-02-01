//
//  SafariWebExtensionHandler.swift
//  Web Agents Extension
//
//  This extension doesn't need native messaging - it communicates with
//  the Harbor extension via extension messaging APIs.
//

import SafariServices
import os

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    
    private static let log = OSLog(subsystem: "org.harbor.webagents", category: "Extension")
    
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey]
        
        os_log(.info, log: Self.log, "Received message from extension")
        
        // Web Agents doesn't need native messaging - it discovers and communicates
        // with Harbor extension via browser extension messaging APIs.
        // This handler is minimal and just acknowledges messages.
        
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: ["status": "ok"]]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
