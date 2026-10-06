import os
import UIKit
import WebKit

/// The slide: the built page from `apps/ios/stage`, in a web view that never takes a touch.
/// Swift never models a slide — a deck goes to the page as the text it was stored as.
@MainActor
final class StageView: UIView {
    struct Station {
        let deckJSON: String
        let stageTitle: String?
        let stationNo: Int
    }

    /// The caption's size on the slide is 2.35% of its width; the reader should get at least this.
    private static let captionPoints: CGFloat = 13
    private static let captionShare: CGFloat = 0.0235

    private let webView: WKWebView
    private let handler = MessageHandler()
    private var isReady = false
    private var pending: [(script: String, arguments: [String: Any])] = []
    private var lastPrefs = ""
    private let log = Logger(subsystem: "dev.jasper.cairn", category: "stage")
    private var gaps: [Int] = []

    var captions = true { didSet { sendPrefs() } }
    var lifted = false { didSet { sendPrefs() } }

    override init(frame: CGRect) {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(handler, name: "cairn")
        configuration.suppressesIncrementalRendering = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init(frame: frame)

        backgroundColor = Palette.stage
        webView.isOpaque = false
        webView.backgroundColor = Palette.stage
        webView.scrollView.isScrollEnabled = false
        webView.isUserInteractionEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        webView.isInspectable = true
        #endif
        addSubview(webView)
        webView.frame = bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        isAccessibilityElement = false

        handler.onMessage = { [weak self] body in self?.receive(body) }
        if let page = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Stage") {
            webView.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
        } else {
            log.error("the slide page is missing from the bundle")
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        sendPrefs()
    }

    func load(_ station: Station) {
        // The deck came from disk or from iCloud: it is handed over as a value and parsed there, never run.
        call(
            "window.cairn.load({deck: JSON.parse(deck), stageTitle, stationNo, locale})",
            arguments: [
                "deck": station.deckJSON,
                "stageTitle": station.stageTitle ?? "",
                "stationNo": station.stationNo,
                "locale": Self.interfaceLocale,
            ])
        gaps.removeAll()
    }

    func sync(ms: Int, rate: Double, playing: Bool) {
        call("window.cairn.sync({ms: \(ms), rate: \(rate), playing: \(playing)})")
    }

    private func sendPrefs() {
        let width = max(bounds.width, 1)
        let scale = max(1, min(3, Self.captionPoints / (width * Self.captionShare)))
        let prefs = "{captions: \(captions), lifted: \(lifted), captionScale: \(String(format: "%.3f", scale))}"
        guard prefs != lastPrefs else { return }
        lastPrefs = prefs
        call("window.cairn.set(\(prefs))")
    }

    private func call(_ script: String, arguments: [String: Any] = [:]) {
        guard isReady else {
            pending.append((script, arguments))
            return
        }
        webView.callAsyncJavaScript(script, arguments: arguments, in: nil, in: .page) { [log] result in
            if case .failure(let error) = result {
                log.error("stage call failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    private func receive(_ body: Any) {
        guard let message = body as? [String: Any], let type = message["type"] as? String else { return }
        switch type {
        case "ready":
            isReady = true
            let queued = pending
            pending.removeAll()
            for call in queued { self.call(call.script, arguments: call.arguments) }
        case "error":
            log.error("stage: \(message["message"] as? String ?? "", privacy: .public)")
        case "gap":
            #if DEBUG
            guard let ms = message["ms"] as? Int else { return }
            gaps.append(ms)
            let worst = gaps.map(abs).max() ?? 0
            log.debug("clock gap \(ms) ms; worst \(worst) ms over \(self.gaps.count) syncs")
            #endif
        default:
            break
        }
    }

    /// The slide's own labels (`Chapter 3`) follow the interface, as on the Mac.
    private static var interfaceLocale: String {
        AppLanguage.code.hasPrefix("zh") ? "zh" : "en"
    }
}

/// `WKUserContentController` holds its handler strongly; this breaks the cycle back to the view.
private final class MessageHandler: NSObject, WKScriptMessageHandler {
    var onMessage: ((Any) -> Void)?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let body = message.body
        MainActor.assumeIsolated { onMessage?(body) }
    }
}
