import Foundation

public enum PlayerChange: Equatable, Sendable {
    /// A different station is loaded; everything shown about the old one is stale.
    case station
    /// Playing, paused, the speed, or a hold.
    case transport
    /// The position moved by playing.
    case position
    /// The position jumped: a seek.
    case seek
    case captions
    case sleep
    case finished
}

/// One book being listened to. Everything on the player screen reads this; it owns the rules,
/// and the sound and the clock are handed in.
@MainActor
public final class PlayerModel {
    public private(set) var book: LibraryBook
    public private(set) var index: Int
    public private(set) var positionMs = 0
    public private(set) var isPlaying = false
    public private(set) var holdRate: Double?
    public private(set) var sleep = SleepTimer.off
    /// The station played to its end and nothing rolled on.
    public private(set) var isAtEnd = false

    public var onChange: ((PlayerChange) -> Void)?
    /// A place worth telling iCloud about.
    public var onSendPlace: ((Place) -> Void)?

    private let library: BookLibrary
    private let engine: AudioEngine
    private let clock: PlayerClock
    private let preferences: PreferenceStore
    private let device: String
    private var schedule = PlaceSchedule()
    private var hasLoaded = false
    /// Audio heard since the book was opened, for telling a second walk from a look.
    private var heardMs = 0

    public init(
        book: LibraryBook, library: BookLibrary, engine: AudioEngine, clock: PlayerClock,
        preferences: PreferenceStore, device: String
    ) {
        self.book = book
        self.library = library
        self.engine = engine
        self.clock = clock
        self.preferences = preferences
        self.device = device
        index = 0
        engine.onEvent = { [weak self] event in self?.handle(event) }
    }

    // MARK: Reading

    public var nodes: [PathNode] { book.manifest?.path.nodes ?? [] }
    public var station: PathNode? { nodes[safe: index] }
    public var durationMs: Int { book.durationMs(at: index) }
    public var rate: Double { preferences.player.rate }
    public var effectiveRate: Double { holdRate ?? rate }
    public var captions: Bool { preferences.player.captions }
    public var hasPrevious: Bool { index > 0 }
    public var hasNext: Bool { book.stations[safe: index + 1]?.isOnDisk == true }
    /// Where the sound is this instant, not at the last tick: what the slide page is synced to.
    public var livePositionMs: Int { isPlaying ? min(engine.positionMs, durationMs) : positionMs }
    public var isFinished: Bool { library.state(of: book.id).finished }

    public func isOnDisk(_ index: Int) -> Bool { book.stations[safe: index]?.isOnDisk == true }

    /// The stage the station belongs to, as the path names it.
    public func stageTitle(of index: Int) -> String? {
        guard let id = nodes[safe: index]?.id else { return nil }
        return book.manifest?.path.stages.first { $0.nodeIds.contains(id) }?.title
    }

    public func sleepRemaining() -> Double? {
        sleep.remaining(now: clock.now, stationRemainingMs: max(0, durationMs - positionMs), rate: effectiveRate)
    }

    // MARK: Opening and closing

    /// Starts playing at the stored place: the reader tapped a book to hear it.
    public func open() {
        let state = library.state(of: book.id)
        let stored = state.finished ? nil : state.place
        let resumed = stored.flatMap { place in nodes.firstIndex { $0.id == place.nodeId } }.flatMap { isOnDisk($0) ? $0 : nil }
        load(resumed ?? 0, startMs: resumed.map { PlaybackRules.startAt(stored, nodeId: nodes[$0].id, durationMs: book.durationMs(at: $0)) } ?? 0, play: true)
    }

    /// Back to the shelf: the sound stops and the place is kept.
    public func close() {
        storePlace(force: true)
        engine.stop()
        isPlaying = false
    }

    public func didEnterBackground() { storePlace(force: true) }

    /// A station arrived or the book changed on disk.
    public func reloadBook() {
        guard let fresh = library.book(book.id), fresh.manifest?.path.nodes.map(\.id) == nodes.map(\.id) else { return }
        book = fresh
        onChange?(.station)
    }

    // MARK: Transport

    public func play() {
        if isAtEnd {
            if hasNext { select(index + 1) }
            return
        }
        engine.play()
    }

    public func pause() { engine.pause() }

    public func togglePlay() { isPlaying ? pause() : play() }

    public func seek(toMs ms: Int) {
        let target = min(max(0, ms), durationMs)
        isAtEnd = false
        engine.seek(toMs: target)
        positionMs = target
        storePlace(force: false)
        onChange?(.seek)
    }

    public func skip(seconds: Double) {
        seek(toMs: positionMs + Int(seconds * 1000))
    }

    public func select(_ target: Int, play: Bool = true) {
        guard isOnDisk(target) else { return }
        load(target, startMs: 0, play: play)
    }

    public func previous() { if hasPrevious { select(index - 1) } }
    public func next() { if hasNext { select(index + 1) } }

    public func setRate(_ rate: Double) {
        preferences.player.rate = rate
        engine.setRate(effectiveRate)
        onChange?(.transport)
    }

    public func beginHold() {
        holdRate = PlaybackRules.holdRate(chosen: rate)
        engine.setRate(effectiveRate)
        onChange?(.transport)
    }

    public func endHold() {
        guard holdRate != nil else { return }
        holdRate = nil
        engine.setRate(effectiveRate)
        onChange?(.transport)
    }

    public func setCaptions(_ on: Bool) {
        preferences.player.captions = on
        onChange?(.captions)
    }

    public func setSleep(_ mode: SleepTimer.Mode) {
        sleep = SleepTimer.start(mode, now: clock.now)
        engine.setVolume(1)
        onChange?(.sleep)
    }

    /// Called a few times a second while the player is on screen or sounding.
    public func tick() {
        guard isPlaying else { return }
        let before = positionMs
        positionMs = min(engine.positionMs, durationMs)
        noteListening(positionMs - before)
        storePlace(force: false)
        if sleep.mode != .off {
            let remaining = sleepRemaining()
            engine.setVolume(SleepTimer.volume(remaining: remaining))
            if case .minutes = sleep.mode, let remaining, remaining <= 0 { fallAsleep() }
        }
        onChange?(.position)
    }

    // MARK: Internals

    private func load(_ target: Int, startMs: Int, play: Bool) {
        // Leaving a station stores where it was left. Nothing is loaded yet when a book opens.
        if hasLoaded, target != index || isAtEnd { storePlace(force: true) }
        hasLoaded = true
        index = target
        positionMs = startMs
        isAtEnd = false
        guard let node = station else { return }
        engine.setRate(effectiveRate)
        engine.load(
            library.audioURL(of: book, nodeId: node.id), startMs: startMs, play: play,
            info: NowPlaying(title: node.title, album: book.manifest?.title ?? "", artwork: book.cover))
        storePlace(force: true)
        onChange?(.station)
    }

    private func handle(_ event: AudioEvent) {
        switch event {
        case .playing(let playing):
            guard playing != isPlaying else { return }
            isPlaying = playing
            if !playing {
                positionMs = min(engine.positionMs, durationMs)
                storePlace(force: true)
            }
            onChange?(.transport)
        case .ended:
            reachedEnd()
        case .failed:
            isPlaying = false
            onChange?(.transport)
        case .remote(let action):
            switch action {
            case .play: play()
            case .pause: pause()
            case .toggle: togglePlay()
            case .skip(let seconds): skip(seconds: seconds)
            case .seek(let ms): seek(toMs: ms)
            }
        }
    }

    private func reachedEnd() {
        positionMs = durationMs
        isPlaying = false
        if index == nodes.count - 1 {
            let end = place(nodeId: nodes[index].id, ms: 0)
            try? library.updateState(of: book.id) { $0.with(place: .some(end), finished: true) }
            onSendPlace?(end)
            isAtEnd = true
            onChange?(.finished)
            return
        }
        let stopHere = sleep.mode == .endOfChapter || !preferences.player.autoplay || !hasNext
        if sleep.mode == .endOfChapter {
            sleep = .off
            engine.setVolume(1)
            onChange?(.sleep)
        }
        if stopHere {
            isAtEnd = true
            storePlace(force: true)
            onChange?(.transport)
        } else {
            select(index + 1)
        }
    }

    private func noteListening(_ stepMs: Int) {
        guard stepMs > 0, stepMs <= PlaybackRules.listenedStepMs, heardMs < PlaybackRules.rereadMs else { return }
        heardMs += stepMs
        guard heardMs >= PlaybackRules.rereadMs, isFinished else { return }
        try? library.updateState(of: book.id) { $0.with(finished: false) }
        onChange?(.finished)
    }

    private func fallAsleep() {
        sleep = .off
        engine.pause()
        engine.setVolume(1)
        onChange?(.sleep)
    }

    private func place(nodeId: String, ms: Int) -> Place {
        Place(nodeId: nodeId, ms: ms, updatedAt: clock.epochMs, device: device)
    }

    /// At the end of a station that did not roll on, the place is the start of the next one.
    private func currentPlace() -> Place? {
        guard let node = station else { return nil }
        if isAtEnd, let next = nodes[safe: index + 1] { return place(nodeId: next.id, ms: 0) }
        return place(nodeId: node.id, ms: positionMs)
    }

    private func storePlace(force: Bool) {
        guard let place = currentPlace() else { return }
        let due = schedule.shouldStore(place, now: clock.now, force: force)
        if due.disk { try? library.updateState(of: book.id) { $0.with(place: .some(place)) } }
        if due.cloud { onSendPlace?(place) }
    }
}
