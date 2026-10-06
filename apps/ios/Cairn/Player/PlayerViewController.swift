import CairnKit
import MediaPlayer
import os
import SnapKit
import UIKit

/// The player: the slide pinned on top, the book below it, and full screen by button or by turning the phone.
final class PlayerViewController: UIViewController {
    /// Controls leave after this long without a touch, and stay while paused.
    private static let controlsLinger: TimeInterval = 2.5
    private static let tickInterval: TimeInterval = 0.25

    private let model: PlayerModel
    private let library: BookLibrary
    private let video = VideoView()
    private let list = ChapterListView(showsInfo: true)
    private var tally = SeekTally()
    private var ticker: Timer?
    private var ticks = 0
    /// AVPlayer's reported time lags for a moment after it starts; sync every tick until it settles.
    private var eagerSyncTicks = 0
    private var hideWork: DispatchWorkItem?
    private var controlsShown = false
    private var isFullscreen = false
    /// Set when a button asked for an orientation the phone is not held in; a real turn clears it.
    private var forcedMask: UIInterfaceOrientationMask?
    private var heldOrientation = UIDeviceOrientation.unknown
    private var loadedIndex = -1
    private let log = Logger(subsystem: "dev.jasper.cairn", category: "player")
    private var lastHoldRate: Double?
    /// What a UI test cannot see on screen: a long press blocks the test until it is released.
    private let probe = UIView()

    init(model: PlayerModel, library: BookLibrary) {
        self.model = model
        self.library = library
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { forcedMask ?? .allButUpsideDown }
    override var prefersStatusBarHidden: Bool { isFullscreen }
    override var preferredStatusBarStyle: UIStatusBarStyle { isFullscreen ? .lightContent : .default }
    override var prefersHomeIndicatorAutoHidden: Bool { isFullscreen && model.isPlaying }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Palette.page
        view.addSubview(list)
        view.addSubview(video)
        list.onSelect = { [weak self] index in self?.model.select(index) }
        wireVideo()
        #if DEBUG
        probe.isAccessibilityElement = true
        probe.accessibilityIdentifier = "player.probe"
        view.addSubview(probe)
        probe.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
        #endif
        model.onChange = { [weak self] change in self?.apply(change) }
        applyLayout(fullscreen: view.bounds.width > view.bounds.height)

        NotificationCenter.default.addObserver(self, selector: #selector(libraryDidChange), name: .cairnLibraryDidChange, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(deviceDidTurn), name: UIDevice.orientationDidChangeNotification, object: nil)
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
        heldOrientation = UIDevice.current.orientation

        // A book opens clean, as a video does once it is playing; a tap brings the controls.
        setControls(shown: UIAccessibility.isVoiceOverRunning, animated: false)
        model.open()
        apply(.station)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        ticker = Timer.scheduledTimer(withTimeInterval: Self.tickInterval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if isMovingFromParent {
            ticker?.invalidate()
            UIDevice.current.endGeneratingDeviceOrientationNotifications()
            model.close()
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let landscape = view.bounds.width > view.bounds.height
        if landscape != isFullscreen { applyLayout(fullscreen: landscape) }
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate { _ in self.applyLayout(fullscreen: size.width > size.height) }
    }

    // MARK: Model

    private func apply(_ change: PlayerChange) {
        switch change {
        case .station:
            loadStation()
            list.show(model)
            video.controls.show(model: model)
            sync()
        case .transport, .finished:
            video.controls.show(model: model)
            showHold()
            if model.isPlaying { scheduleHide() } else { wakeControls(linger: false) }
            UIApplication.shared.isIdleTimerDisabled = model.isPlaying
            setNeedsUpdateOfHomeIndicatorAutoHidden()
            if change == .finished { list.show(model) }
            sync()
        case .seek:
            showPosition()
            sync()
        case .position:
            showPosition()
        case .captions:
            video.stage.captions = model.captions
            video.controls.show(model: model)
        case .sleep:
            video.controls.showTime(model: model)
        }
    }

    private func loadStation() {
        guard let node = model.station else { return }
        if loadedIndex != model.index {
            loadedIndex = model.index
            do {
                let deck = try library.deckText(of: model.book, nodeId: node.id)
                video.stage.load(.init(deckJSON: deck, stageTitle: model.stageTitle(of: model.index), stationNo: model.index + 1))
            } catch {
                log.error("deck \(node.id, privacy: .public) unreadable: \(error.localizedDescription, privacy: .public)")
            }
        }
        video.stage.captions = model.captions
        showPosition()
    }

    private func showPosition() {
        let duration = model.durationMs
        video.showProgress(duration > 0 ? Double(model.positionMs) / Double(duration) : 0)
        video.controls.showTime(model: model)
    }

    private func sync(eager: Bool = true) {
        if eager { eagerSyncTicks = 8 }
        video.stage.sync(ms: model.livePositionMs, rate: model.effectiveRate, playing: model.isPlaying)
    }

    private func tick() {
        model.tick()
        updateProbe()
        ticks += 1
        guard model.isPlaying else { return }
        if eagerSyncTicks > 0 {
            eagerSyncTicks -= 1
            sync(eager: false)
        } else if ticks % 2 == 0 {
            sync(eager: false)
        }
    }

    private func updateProbe() {
        #if DEBUG
        probe.accessibilityValue = [
            "index=\(model.index)", "ms=\(model.livePositionMs)", "playing=\(model.isPlaying)",
            "rate=\(model.effectiveRate)", "lastHold=\(lastHoldRate ?? 0)", "controls=\(controlsShown)",
            "fullscreen=\(isFullscreen)", "sleep=\(model.sleep.mode)", "finished=\(model.isFinished)",
            "idle=\(UIApplication.shared.isIdleTimerDisabled ? "off" : "on")",
        ].joined(separator: " ")
        let title = MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyTitle] as? String
        probe.accessibilityLabel = title
        #endif
    }

    private func showHold() {
        if let rate = model.holdRate {
            video.holdPill.show(rate: rate)
            video.holdPill.isHidden = false
        } else {
            video.holdPill.isHidden = true
        }
    }

    @objc private func libraryDidChange() {
        model.reloadBook()
    }

    // MARK: Controls

    private func wireVideo() {
        video.onTap = { [weak self] in
            guard let self else { return }
            controlsShown ? hideControls() : wakeControls()
        }
        video.onDoubleTap = { [weak self] side in
            guard let self else { return }
            let total = tally.tap(side == .forward ? .forward : .back, now: ProcessInfo.processInfo.systemUptime)
            model.skip(seconds: Double(side == .forward ? PlaybackRules.seekStepSeconds : -PlaybackRules.seekStepSeconds))
            (side == .forward ? video.forwardArc : video.backArc).show(seconds: total)
            if controlsShown { scheduleHide() }
        }
        video.onHold = { [weak self] began in
            guard let self else { return }
            if began {
                model.beginHold()
                lastHoldRate = model.holdRate
            } else {
                model.endHold()
            }
        }

        var actions = ControlsView.Actions()
        actions.touched = { [weak self] in self?.scheduleHide() }
        actions.back = { [weak self] in self?.goBack() }
        actions.captions = { [weak self] in
            guard let self else { return }
            model.setCaptions(!model.captions)
        }
        actions.rate = { [weak self] rate in self?.model.setRate(rate) }
        actions.sleep = { [weak self] in
            guard let self else { return }
            presentSheet(SleepSheetController(model: model))
        }
        actions.chapters = { [weak self] in
            guard let self else { return }
            presentSheet(ChaptersSheetController(model: model))
        }
        actions.previous = { [weak self] in self?.model.previous() }
        actions.next = { [weak self] in self?.model.next() }
        actions.playPause = { [weak self] in self?.model.togglePlay() }
        actions.fullscreen = { [weak self] in
            guard let self else { return }
            requestFullscreen(!isFullscreen)
        }
        actions.scrub = { [weak self] fraction, done in
            guard let self else { return }
            let ms = Int(fraction * Double(model.durationMs))
            if done { model.seek(toMs: ms) } else { video.controls.showScrubPreview(ms: ms, durationMs: model.durationMs) }
        }
        video.controls.actions = actions
    }

    private func presentSheet(_ controller: UIViewController) {
        hideWork?.cancel()
        let navigation = controller is UITableViewController ? UINavigationController(rootViewController: controller) : controller
        if let sheet = navigation.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
        }
        navigation.overrideUserInterfaceStyle = .unspecified
        present(navigation, animated: true)
    }

    private func goBack() {
        if isFullscreen {
            requestFullscreen(false)
        } else {
            navigationController?.popViewController(animated: true)
        }
    }

    private func wakeControls(linger: Bool = true) {
        setControls(shown: true)
        if linger { scheduleHide() }
    }

    private func hideControls() {
        guard model.isPlaying, !UIAccessibility.isVoiceOverRunning else { return }
        setControls(shown: false)
    }

    private func scheduleHide() {
        hideWork?.cancel()
        guard model.isPlaying, controlsShown else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self, !video.controls.scrubber.isScrubbing, presentedViewController == nil else { return }
            hideControls()
        }
        hideWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.controlsLinger, execute: work)
    }

    private func setControls(shown: Bool, animated: Bool = true) {
        controlsShown = shown
        video.setControlsShown(shown)
        let controls = video.controls
        if shown { controls.isHidden = false }
        let change = { controls.alpha = shown ? 1 : 0 }
        let done = { (_: Bool) in if !self.controlsShown { controls.isHidden = true } }
        if UIAccessibility.isReduceMotionEnabled || !animated {
            change()
            done(true)
        } else {
            UIView.animate(withDuration: 0.2, animations: change, completion: done)
        }
        updateProbe()
    }

    // MARK: Full screen

    private func requestFullscreen(_ on: Bool) {
        forcedMask = on ? .landscape : .portrait
        heldOrientation = UIDevice.current.orientation
        setNeedsUpdateOfSupportedInterfaceOrientations()
        let wanted: UIInterfaceOrientationMask = on ? .landscapeRight : .portrait
        view.window?.windowScene?.requestGeometryUpdate(.iOS(interfaceOrientations: wanted)) { [log] error in
            log.error("rotation refused: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Turning the phone after a button forced the orientation hands control back to the phone.
    @objc private func deviceDidTurn() {
        let now = UIDevice.current.orientation
        guard now.isPortrait || now.isLandscape, now != heldOrientation else { return }
        heldOrientation = now
        guard forcedMask != nil else { return }
        forcedMask = nil
        setNeedsUpdateOfSupportedInterfaceOrientations()
    }

    private func applyLayout(fullscreen: Bool) {
        isFullscreen = fullscreen
        list.isHidden = fullscreen
        view.backgroundColor = fullscreen ? .black : Palette.page
        video.snp.remakeConstraints { make in
            if fullscreen {
                make.edges.equalToSuperview()
            } else {
                make.top.equalTo(view.safeAreaLayoutGuide)
                make.leading.trailing.equalToSuperview()
                make.height.equalTo(video.snp.width).multipliedBy(9.0 / 16.0)
            }
        }
        list.snp.remakeConstraints { make in
            make.top.equalTo(video.snp.bottom)
            make.leading.trailing.bottom.equalToSuperview()
        }
        video.setFullscreen(fullscreen)
        video.controls.show(model: model)
        updateProbe()
        if !fullscreen, presentedViewController is ChaptersSheetController { dismiss(animated: false) }
        setNeedsStatusBarAppearanceUpdate()
        setNeedsUpdateOfHomeIndicatorAutoHidden()
    }
}
