import Cocoa
import WebKit
import Speech
import AVFoundation
import UniformTypeIdentifiers

// MARK: - Native dictation (Apple speech recognizer), bridged to the web page

final class DictationController: NSObject {
    weak var webView: WKWebView?
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var lastText = ""
    private var active = false
    private var silenceTimer: Timer?

    func start(locale: String) {
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    self.send("error", "Speech recognition is off for Cadence. Turn it on in System Settings, Privacy and Security, Speech Recognition.")
                    return
                }
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    DispatchQueue.main.async {
                        guard granted else {
                            self.send("error", "Microphone access is off for Cadence. Turn it on in System Settings, Privacy and Security, Microphone.")
                            return
                        }
                        self.begin(locale: locale)
                    }
                }
            }
        }
    }

    private func begin(locale: String) {
        teardown()
        let rec = SFSpeechRecognizer(locale: Locale(identifier: locale)) ?? SFSpeechRecognizer()
        guard let recognizer = rec, recognizer.isAvailable else {
            send("error", "Speech recognition is not available right now.")
            return
        }
        self.recognizer = recognizer
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        request = req
        lastText = ""

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            send("error", "Could not start the microphone.")
            return
        }
        active = true
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self = self, self.active else { return }
                if let result = result {
                    self.lastText = result.bestTranscription.formattedString
                    if result.isFinal {
                        self.finish()
                        return
                    }
                    self.send("partial", self.lastText)
                    self.armSilenceTimer(seconds: 1.6)
                }
                if error != nil { self.finish() }
            }
        }
        armSilenceTimer(seconds: 6.0)
    }

    // End of utterance: stop after a short pause in speech.
    private func armSilenceTimer(seconds: TimeInterval) {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            self?.finish()
        }
    }

    func finish() {
        guard active else { return }
        active = false
        let text = lastText.trimmingCharacters(in: .whitespacesAndNewlines)
        teardown()
        send(text.isEmpty ? "end" : "final", text)
    }

    private func teardown() {
        silenceTimer?.invalidate()
        silenceTimer = nil
        if engine.isRunning {
            engine.stop()
        }
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
    }

    private func send(_ type: String, _ text: String) {
        let payload: [String: String] = ["type": type, "text": text]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.__cadenceDictation && window.__cadenceDictation(\(json))", completionHandler: nil)
    }
}

// MARK: - App

@available(macOS 12.0, *)
final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate, WKScriptMessageHandler, NSWindowDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var serverProcess: Process?
    let dictation = DictationController()
    // The installed app uses its own port so it never attaches to a development server.
    lazy var port: String = ProcessInfo.processInfo.environment["PORT"] ?? (bundledApp != nil ? "3848" : "3847")
    var serverURL: URL { URL(string: "http://127.0.0.1:\(port)")! }
    var downloadTargets: [ObjectIdentifier: URL] = [:]

    // Server files packaged inside the app (release builds).
    lazy var bundledApp: URL? = {
        guard let res = Bundle.main.resourceURL?.appendingPathComponent("app") else { return nil }
        return FileManager.default.fileExists(atPath: res.appendingPathComponent("server.js").path) ? res : nil
    }()

    // Installed builds keep documents in Application Support, outside the app bundle.
    lazy var dataDir: URL? = {
        guard bundledApp != nil else { return nil }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return support.appendingPathComponent("Cadence/data")
    }()

    lazy var legacyDataDir: URL = URL(fileURLWithPath: NSHomeDirectory())
        .appendingPathComponent(".gemini/antigravity/scratch/voice-manuscript-studio/data")

    // Priority: CADENCE_ROOT, files inside the app, the folder beside the app, the original project path.
    lazy var projectRoot: URL = {
        if let env = ProcessInfo.processInfo.environment["CADENCE_ROOT"] {
            return URL(fileURLWithPath: env)
        }
        if let bundled = bundledApp { return bundled }
        let besideBundle = Bundle.main.bundleURL.deletingLastPathComponent()
        if FileManager.default.fileExists(atPath: besideBundle.appendingPathComponent("server.js").path) {
            return besideBundle
        }
        return URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".gemini/antigravity/scratch/voice-manuscript-studio")
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMainMenu()

        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let width = min(1360.0, screen.width * 0.9)
        let height = min(900.0, screen.height * 0.9)
        let frame = NSRect(x: screen.midX - width / 2, y: screen.midY - height / 2, width: width, height: height)

        window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Cadence"
        window.minSize = NSSize(width: 820, height: 560)
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("CadenceMainWindow")

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "cadenceDictation")

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        window.contentView?.addSubview(webView)
        dictation.webView = webView

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        showStatus("Starting Cadence")
        checkServer { [weak self] up in
            guard let self = self else { return }
            if up { self.webView.load(URLRequest(url: self.serverURL)) }
            else { self.startNodeServer() }
        }
    }

    // MARK: Server

    func checkServer(_ done: @escaping (Bool) -> Void) {
        var req = URLRequest(url: serverURL.appendingPathComponent("api/health"))
        req.timeoutInterval = 0.8
        URLSession.shared.dataTask(with: req) { _, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { done(ok) }
        }.resume()
    }

    func nodeExecutable() -> String? {
        if let res = Bundle.main.resourceURL?.appendingPathComponent("node/bin/node").path,
           FileManager.default.isExecutableFile(atPath: res) {
            return res
        }
        let home = NSHomeDirectory()
        let candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "\(home)/.homebrew/bin/node", "\(home)/.volta/bin/node", "/usr/bin/node"]
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    func startNodeServer() {
        let proc = Process()
        proc.currentDirectoryURL = projectRoot
        if let node = nodeExecutable() {
            proc.executableURL = URL(fileURLWithPath: node)
            proc.arguments = ["server.js"]
        } else {
            proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
            proc.arguments = ["-lc", "node server.js"]
        }
        var env = ProcessInfo.processInfo.environment
        env["PORT"] = port
        if let data = dataDir {
            migrateLegacyData(to: data)
            env["CADENCE_DATA_DIR"] = data.path
        }
        proc.environment = env

        let logURL = (dataDir ?? projectRoot.appendingPathComponent("data")).appendingPathComponent("server.log")
        try? FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        if let handle = try? FileHandle(forWritingTo: logURL) {
            proc.standardOutput = handle
            proc.standardError = handle
        }

        do {
            try proc.run()
            serverProcess = proc
        } catch {
            showStatus(bundledApp != nil
                ? "Could not start the Cadence server inside the app. Try downloading the app again."
                : "Could not start the Cadence server. Check that Node.js is installed, then run npm install in \(projectRoot.path).")
            return
        }
        waitForServer(attempts: 60)
    }

    // First launch of the installed app: copy documents and settings from the original project folder.
    func migrateLegacyData(to data: URL) {
        let fm = FileManager.default
        let docs = data.appendingPathComponent("documents")
        let hasDocs = ((try? fm.contentsOfDirectory(atPath: docs.path)) ?? []).contains { $0.hasSuffix(".json") }
        try? fm.createDirectory(at: data, withIntermediateDirectories: true)
        guard !hasDocs, fm.fileExists(atPath: legacyDataDir.appendingPathComponent("documents").path) else { return }
        for item in ["documents", "revisions", "config.json"] {
            let src = legacyDataDir.appendingPathComponent(item)
            let dst = data.appendingPathComponent(item)
            guard fm.fileExists(atPath: src.path) else { continue }
            try? fm.removeItem(at: dst)
            try? fm.copyItem(at: src, to: dst)
        }
    }

    // Poll until the server answers rather than waiting a fixed time.
    func waitForServer(attempts: Int) {
        checkServer { [weak self] up in
            guard let self = self else { return }
            if up {
                self.webView.load(URLRequest(url: self.serverURL))
            } else if attempts > 0, self.serverProcess?.isRunning ?? false {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.waitForServer(attempts: attempts - 1) }
            } else {
                let log = (self.dataDir ?? self.projectRoot.appendingPathComponent("data")).appendingPathComponent("server.log")
                self.showStatus("The Cadence server did not start. Details are in \(log.path).")
            }
        }
    }

    func showStatus(_ message: String) {
        let safe = message.replacingOccurrences(of: "<", with: "&lt;")
        let html = """
        <html><head><meta name="color-scheme" content="light dark"><style>
        body{font:15px -apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#5b6573;background:Canvas}
        </style></head><body><p>\(safe)</p></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: Dictation bridge

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "cadenceDictation", let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        if cmd == "start" {
            dictation.start(locale: body["locale"] as? String ?? "en-CA")
        } else if cmd == "stop" {
            dictation.finish()
        }
    }

    // MARK: File picker for <input type="file">

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedContentTypes = ["docx", "md", "markdown", "txt"].compactMap { UTType(filenameExtension: $0) }
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    // MARK: Downloads (export)

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let http = navigationResponse.response as? HTTPURLResponse,
           let disposition = http.value(forHTTPHeaderField: "Content-Disposition"),
           disposition.lowercased().hasPrefix("attachment") {
            decisionHandler(.download)
            return
        }
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first ?? URL(fileURLWithPath: NSHomeDirectory())
        let base = (suggestedFilename as NSString).deletingPathExtension
        let ext = (suggestedFilename as NSString).pathExtension
        var url = folder.appendingPathComponent(suggestedFilename)
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = folder.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
            n += 1
        }
        downloadTargets[ObjectIdentifier(download)] = url
        completionHandler(url)
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let url = downloadTargets.removeValue(forKey: ObjectIdentifier(download)) {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadTargets.removeValue(forKey: ObjectIdentifier(download))
        let alert = NSAlert()
        alert.messageText = "Export failed"
        alert.informativeText = error.localizedDescription
        alert.beginSheetModal(for: window)
    }

    // MARK: Media and JavaScript panels

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == "127.0.0.1" || origin.host == "localhost" ? .grant : .prompt)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
    }

    // MARK: Lifecycle

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        dictation.finish()
        if let proc = serverProcess, proc.isRunning { proc.terminate() }
    }

    // MARK: Menus

    func setupMainMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Cadence", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Cadence", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Cadence", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let view = NSMenu(title: "View")
        let reload = view.addItem(withTitle: "Reload", action: #selector(reloadWebView), keyEquivalent: "r")
        reload.keyEquivalentModifierMask = [.command, .shift]
        view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f").keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = view

        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = win
        NSApp.windowsMenu = win

        NSApp.mainMenu = main
    }

    @objc func reloadWebView() {
        webView.reload()
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
if #available(macOS 12.0, *) {
    let delegate = AppDelegate()
    app.delegate = delegate
    app.run()
}
