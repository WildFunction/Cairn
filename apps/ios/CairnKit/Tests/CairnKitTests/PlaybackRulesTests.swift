import Testing
@testable import CairnKit

@Suite struct PlaybackRulesTests {
    @Test func startAtMatchesTheDesktop() {
        let place = Place(nodeId: "n1", ms: 42_000, updatedAt: 0, device: "d")
        #expect(PlaybackRules.startAt(place, nodeId: "n1", durationMs: 200_000) == 42_000)
        #expect(PlaybackRules.startAt(place, nodeId: "n2", durationMs: 200_000) == 0, "another station starts from the top")
        #expect(PlaybackRules.startAt(nil, nodeId: "n1", durationMs: 200_000) == 0)
        let early = Place(nodeId: "n1", ms: 7_999, updatedAt: 0, device: "d")
        #expect(PlaybackRules.startAt(early, nodeId: "n1", durationMs: 200_000) == 0, "inside the first 8 s")
        let late = Place(nodeId: "n1", ms: 196_000, updatedAt: 0, device: "d")
        #expect(PlaybackRules.startAt(late, nodeId: "n1", durationMs: 200_000) == 0, "inside the last 5 s")
        #expect(PlaybackRules.startAt(late, nodeId: "n1", durationMs: 0) == 196_000, "unknown length: floor only")
    }

    @Test func aHoldPlaysAtTwiceUnlessThatIsNoFaster() {
        #expect(PlaybackRules.holdRate(chosen: 1) == 2)
        #expect(PlaybackRules.holdRate(chosen: 1.5) == 2)
        #expect(PlaybackRules.holdRate(chosen: 2) == 3)
        #expect(PlaybackRules.holdRate(chosen: 3) == 3)
    }

    @Test func theSpeedsAreTheDesktops() {
        #expect(PlaybackRules.rates == [0.75, 1, 1.25, 1.5, 2, 3])
    }
}

@Suite struct SeekTallyTests {
    @Test func doubleTapsOnOneSideAddUp() {
        var tally = SeekTally()
        #expect(tally.tap(.forward, now: 0) == 10)
        #expect(tally.tap(.forward, now: 0.6) == 20)
        #expect(tally.tap(.forward, now: 1.2) == 30)
    }

    @Test func aPauseOrTheOtherSideStartsOver() {
        var tally = SeekTally()
        #expect(tally.tap(.forward, now: 0) == 10)
        #expect(tally.tap(.forward, now: 5) == 10)
        #expect(tally.tap(.back, now: 5.3) == 10)
    }
}

@Suite struct PlaceScheduleTests {
    let at = { (node: String, ms: Int) in Place(nodeId: node, ms: ms, updatedAt: 0, device: "d") }

    @Test func diskIsWrittenEveryFiveSecondsOfMovement() {
        var schedule = PlaceSchedule()
        #expect(schedule.shouldStore(at("n0", 1000), now: 0, force: false).disk)
        #expect(!schedule.shouldStore(at("n0", 5999), now: 1, force: false).disk)
        #expect(schedule.shouldStore(at("n0", 6000), now: 2, force: false).disk)
        #expect(schedule.shouldStore(at("n1", 6100), now: 3, force: false).disk, "a new station is always written")
        #expect(schedule.shouldStore(at("n1", 6200), now: 4, force: true).disk, "pause and backgrounding force it")
    }

    @Test func iCloudHearsAtMostEveryThirtySecondsUnlessForced() {
        var schedule = PlaceSchedule()
        #expect(schedule.shouldStore(at("n0", 0), now: 0, force: false).cloud)
        #expect(!schedule.shouldStore(at("n0", 10_000), now: 10, force: false).cloud)
        #expect(!schedule.shouldStore(at("n0", 29_000), now: 29, force: false).cloud)
        #expect(schedule.shouldStore(at("n0", 30_000), now: 30, force: false).cloud)
        #expect(schedule.shouldStore(at("n0", 31_000), now: 31, force: true).cloud)
    }
}

@Suite struct SleepTimerTests {
    @Test func aTimedSleepCountsDownFromWhenItWasSet() {
        let timer = SleepTimer.start(.minutes(15), now: 100)
        #expect(timer.remaining(now: 100, stationRemainingMs: 0, rate: 1) == 900)
        #expect(timer.remaining(now: 1000, stationRemainingMs: 0, rate: 1) == 0)
        #expect(SleepTimer.off.remaining(now: 0, stationRemainingMs: 50_000, rate: 1) == nil)
    }

    @Test func endOfChapterIsTheStationsRemainingAudioAtTheCurrentSpeed() {
        let timer = SleepTimer.start(.endOfChapter, now: 0)
        #expect(timer.remaining(now: 50, stationRemainingMs: 60_000, rate: 2) == 30)
    }

    @Test func theSoundFadesOverTheLastFiveSeconds() {
        #expect(SleepTimer.volume(remaining: nil) == 1)
        #expect(SleepTimer.volume(remaining: 20) == 1)
        #expect(SleepTimer.volume(remaining: 5) == 1)
        #expect(SleepTimer.volume(remaining: 2.5) == 0.5)
        #expect(SleepTimer.volume(remaining: 0) == 0)
    }
}
