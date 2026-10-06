import Foundation
import Testing
@testable import CairnKit

@MainActor
final class FakeEngine: AudioEngine {
    var onEvent: ((AudioEvent) -> Void)?
    var positionMs = 0
    var loaded: [(URL, Int, Bool)] = []
    var rate = 1.0
    var volume: Float = 1
    var playing = false
    var stopped = false

    func load(_ url: URL, startMs: Int, play: Bool, info: NowPlaying) {
        loaded.append((url, startMs, play))
        positionMs = startMs
        if play { self.play() } else { self.pause() }
    }
    func play() { playing = true; onEvent?(.playing(true)) }
    func pause() { playing = false; onEvent?(.playing(false)) }
    func stop() { stopped = true; pause() }
    func seek(toMs ms: Int) { positionMs = ms }
    func setRate(_ rate: Double) { self.rate = rate }
    func setVolume(_ volume: Float) { self.volume = volume }

    func advance(by ms: Int) { positionMs += Int(Double(ms) * rate) }
}

final class FakeClock: PlayerClock, @unchecked Sendable {
    var now: Double = 1000
    var epochMs: Int { Int(now * 1000) }
}

@MainActor
@Suite struct PlayerModelTests {
    let fixture: CloudFixture
    let scratch: Scratch
    let engine = FakeEngine()
    let clock = FakeClock()
    let preferences = MemoryPreferences()

    init() throws {
        fixture = try CloudFixture.syntheticBook()
        scratch = try Scratch()
        try scratch.writeAll(fixture: fixture)
    }

    private func model() throws -> PlayerModel {
        let book = try #require(scratch.library.book(Scratch.bookId))
        return PlayerModel(
            book: book, library: scratch.library, engine: engine, clock: clock, preferences: preferences, device: "phone")
    }

    private var stored: Place? { scratch.library.state(of: Scratch.bookId).place }

    @Test func openingAFreshBookPlaysTheFirstStationFromTheTop() throws {
        let player = try model()
        player.open()
        #expect(player.index == 0)
        #expect(engine.loaded.last?.1 == 0)
        #expect(engine.loaded.last?.2 == true)
        #expect(player.isPlaying)
        #expect(engine.loaded.last?.0.lastPathComponent == "n0.mp3")
    }

    @Test func openingResumesWhereTheReaderStopped() throws {
        let long = try fixture.string("n0", "deck").replacingOccurrences(of: #""durationMs":9000"#, with: #""durationMs":60000"#)
        try scratch.library.writeStation(bookId: Scratch.bookId, nodeId: "n0", deck: long, audio: scratch.audio, fingerprint: "f")
        try scratch.library.updateState(of: Scratch.bookId) {
            $0.with(place: .some(Place(nodeId: "n0", ms: 8500, updatedAt: 1, device: "mac")))
        }
        let player = try model()
        player.open()
        #expect(engine.loaded.last?.1 == 8500)
        #expect(player.positionMs == 8500)
    }

    @Test func openingAtALaterStationNeverReportsTheFirstOne() throws {
        try scratch.library.updateState(of: Scratch.bookId) {
            $0.with(place: .some(Place(nodeId: "recap", ms: 1000, updatedAt: 1, device: "mac")))
        }
        let player = try model()
        var sent: [String] = []
        player.onSendPlace = { sent.append($0.nodeId) }
        player.open()
        #expect(player.index == 1)
        #expect(sent == ["recap"])
    }

    @Test func openingAFinishedBookStartsItAgain() throws {
        try scratch.library.updateState(of: Scratch.bookId) {
            $0.with(place: .some(Place(nodeId: "recap", ms: 0, updatedAt: 1, device: "mac")), finished: true)
        }
        let player = try model()
        player.open()
        #expect(player.index == 0)
        #expect(player.isFinished, "opening it to look is not re-reading it")
    }

    @Test func aFinishedBookStaysFinishedUntilAMinuteOfItIsHeardAgain() throws {
        let long = try fixture.string("n0", "deck").replacingOccurrences(of: #""durationMs":9000"#, with: #""durationMs":600000"#)
        try scratch.library.writeStation(bookId: Scratch.bookId, nodeId: "n0", deck: long, audio: scratch.audio, fingerprint: "f")
        try scratch.library.updateState(of: Scratch.bookId) { $0.with(finished: true) }
        let player = try model()
        player.open()
        for _ in 0..<59 {
            engine.advance(by: 1000)
            player.tick()
        }
        #expect(player.isFinished)
        player.seek(toMs: 300_000)
        player.tick()
        #expect(player.isFinished, "a seek is not listening")
        engine.advance(by: 1000)
        player.tick()
        #expect(!player.isFinished)
        guard case .progress(chapter: 1, _, _)? = scratch.library.book(Scratch.bookId)?.foot else {
            Issue.record("the card should show where the second walk is, not Finished")
            return
        }
    }

    @Test func thePlaceIsWrittenOnPauseAndEveryFiveSeconds() throws {
        let player = try model()
        player.open()
        engine.advance(by: 3000)
        player.tick()
        #expect(stored?.ms == 0)
        engine.advance(by: 2500)
        player.tick()
        #expect(stored?.ms == 5500)
        engine.advance(by: 300)
        player.pause()
        #expect(stored?.ms == 5800)
        #expect(stored?.device == "phone")
    }

    @Test func iCloudHearsOfThePlaceOnPauseAndNoMoreThanEveryThirtySeconds() throws {
        let player = try model()
        var sent: [Int] = []
        player.onSendPlace = { sent.append($0.ms) }
        player.open()
        for _ in 0..<8 {
            engine.advance(by: 1000)
            clock.now += 1
            player.tick()
        }
        #expect(sent == [0])
        player.pause()
        #expect(sent == [0, 8000])
    }

    @Test func aStationThatEndsRollsIntoTheNext() throws {
        let player = try model()
        player.open()
        engine.onEvent?(.ended)
        #expect(player.index == 1)
        #expect(engine.loaded.last?.2 == true)
        #expect(stored?.nodeId == "recap")
    }

    @Test func withAutoplayOffItStopsAndRemembersTheNextStation() throws {
        preferences.player.autoplay = false
        let player = try model()
        player.open()
        engine.pause()
        engine.onEvent?(.ended)
        #expect(player.index == 0)
        #expect(player.isAtEnd)
        #expect(stored == Place(nodeId: "recap", ms: 0, updatedAt: clock.epochMs, device: "phone"))
        player.play()
        #expect(player.index == 1, "play at the end of a station goes on to the next")
    }

    @Test func finishingTheRecapFinishesTheBook() throws {
        let player = try model()
        var sent: [Place] = []
        player.onSendPlace = { sent.append($0) }
        player.open()
        player.select(1)
        engine.onEvent?(.ended)
        #expect(player.isFinished)
        #expect(sent.last?.nodeId == "recap", "the other device hears the book was finished")
        #expect(scratch.library.book(Scratch.bookId)?.foot == .finished)
    }

    @Test func aHoldUsesTwiceOrThriceAndReleaseRestoresTheChosenSpeed() throws {
        let player = try model()
        player.open()
        player.setRate(1.25)
        player.beginHold()
        #expect(engine.rate == 2)
        player.endHold()
        #expect(engine.rate == 1.25)
        player.setRate(2)
        player.beginHold()
        #expect(engine.rate == 3)
        player.setRate(1)
        #expect(engine.rate == 3, "a speed chosen mid-hold waits for the release")
        player.endHold()
        #expect(engine.rate == 1)
        #expect(preferences.player.rate == 1)
    }

    @Test func skippingStaysInsideTheStation() throws {
        let player = try model()
        player.open()
        player.skip(seconds: -10)
        #expect(engine.positionMs == 0)
        player.skip(seconds: 20)
        #expect(engine.positionMs == 9000)
    }

    @Test func aTimedSleepFadesThenPausesAndStoresThePlace() throws {
        let player = try model()
        player.open()
        player.setSleep(.minutes(15))
        clock.now += 15 * 60 - 2.5
        engine.advance(by: 1000)
        player.tick()
        #expect(engine.volume == 0.5)
        clock.now += 3
        engine.advance(by: 1000)
        player.tick()
        #expect(!player.isPlaying)
        #expect(player.sleep == .off)
        #expect(engine.volume == 1)
        #expect(stored?.ms == 2000)
    }

    @Test func sleepAtTheEndOfAChapterStopsThereInsteadOfRollingOn() throws {
        let player = try model()
        player.open()
        player.setSleep(.endOfChapter)
        engine.positionMs = 7000
        player.tick()
        #expect(engine.volume == 0.4, "the last five seconds of the station fade")
        engine.onEvent?(.ended)
        #expect(player.index == 0)
        #expect(!player.isPlaying)
        #expect(player.sleep == .off)
        #expect(stored?.nodeId == "recap")
    }

    @Test func remoteCommandsGoThroughTheSameRules() throws {
        let player = try model()
        player.open()
        engine.onEvent?(.remote(.pause))
        #expect(!player.isPlaying)
        engine.onEvent?(.remote(.skip(seconds: 5)))
        #expect(engine.positionMs == 5000)
        engine.onEvent?(.remote(.seek(ms: 2000)))
        #expect(player.positionMs == 2000)
        engine.onEvent?(.remote(.toggle))
        #expect(player.isPlaying)
    }

    @Test func closingStopsTheSoundAndKeepsThePlace() throws {
        let player = try model()
        player.open()
        engine.advance(by: 1200)
        player.tick()
        player.close()
        #expect(engine.stopped)
        #expect(stored?.ms == 1200)
    }

    @Test func aStationNotYetOnDiskCannotBeSelected() throws {
        try scratch.library.removeStation(bookId: Scratch.bookId, nodeId: "recap")
        let player = try model()
        player.open()
        player.select(1)
        #expect(player.index == 0)
        #expect(!player.hasNext)
        engine.onEvent?(.ended)
        #expect(player.isAtEnd && player.index == 0)
    }

    @Test func theCaptionsSwitchIsRemembered() throws {
        let player = try model()
        player.setCaptions(false)
        #expect(preferences.player.captions == false)
    }
}
