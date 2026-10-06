import XCTest

/// The plan's walk-through, the parts the player tests do not already cover: endings, the shelf, relaunch.
@MainActor
final class WalkthroughUITests: XCTestCase {
    private static let bookCard = "shelf.book.the-art-of-war-ed02db"

    override func setUp() async throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    private func showControls(_ app: XCUIApplication, _ probe: Probe) {
        if probe.state("controls") == "false" {
            app.otherElements["player.video"].coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).tap()
        }
        probe.wait("controls", "true", timeout: 3)
    }

    private func pause(_ app: XCUIApplication, _ probe: Probe) {
        probe.wait("controls", "false", timeout: 6)
        showControls(app, probe)
        app.buttons["player.playPause"].tap()
        probe.wait("playing", "false")
    }

    /// Paused, controls up: tap the scrubber at a fraction of the station.
    private func scrub(_ app: XCUIApplication, to fraction: CGFloat) {
        app.otherElements["player.scrubber"].coordinate(withNormalizedOffset: CGVector(dx: fraction, dy: 0.5)).tap()
    }

    private func play(_ app: XCUIApplication, _ probe: Probe) {
        showControls(app, probe)
        app.buttons["player.playPause"].tap()
        probe.wait("playing", "true")
    }

    func testEndOfChapterSleepStopsThereAndDoesNotRollOn() {
        let app = XCUIApplication.cairn()
        app.launch()
        let probe = Probe(app: app)
        probe.wait("playing", "true", timeout: 10)
        pause(app, probe)
        app.buttons["player.sleep"].tap()
        app.cells["sleep.choice.5"].tap()
        probe.wait("sleep", "endOfChapter")
        scrub(app, to: 0.985)
        play(app, probe)
        probe.wait("playing", "false", timeout: 12)
        XCTAssertEqual(probe.state("index"), "0")
        XCTAssertEqual(probe.state("sleep"), "off")
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        XCTAssertEqual(probe.state("playing"), "false", "it did not roll on")
    }

    func testAStationThatEndsWithTheTimerOffRollsIntoTheNext() {
        let app = XCUIApplication.cairn()
        app.launch()
        let probe = Probe(app: app)
        probe.wait("playing", "true", timeout: 10)
        pause(app, probe)
        scrub(app, to: 0.985)
        play(app, probe)
        probe.wait("index", "1", timeout: 12)
        probe.wait("playing", "true")
    }

    func testBackToTheShelfStopsTheSoundAndARelaunchResumesThere() {
        var app = XCUIApplication.cairn()
        app.launch()
        var probe = Probe(app: app)
        probe.wait("playing", "true", timeout: 10)
        pause(app, probe)
        scrub(app, to: 0.5)
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        let stopped = probe.ms()
        XCTAssertGreaterThan(stopped, 90_000)
        app.buttons["player.back"].tap()

        let card = app.cells[Self.bookCard]
        XCTAssertTrue(card.waitForExistence(timeout: 3))
        let clock = String(format: "%d:%02d", (stopped / 1000) / 60, (stopped / 1000) % 60)
        XCTAssertTrue(card.label.contains("Chapter 1 · \(clock)"), "the card says where: \(card.label)")

        app.terminate()
        app = XCUIApplication.cairn(fresh: false, open: false)
        app.launch()
        XCTAssertTrue(app.cells[Self.bookCard].waitForExistence(timeout: 5))
        app.cells[Self.bookCard].tap()
        probe = Probe(app: app)
        probe.wait("playing", "true", timeout: 10)
        XCTAssertEqual(probe.state("index"), "0")
        XCTAssertGreaterThanOrEqual(probe.ms(), stopped)
        XCTAssertLessThan(probe.ms(), stopped + 5000)
    }

    func testFinishingTheRecapMarksTheBookFinished() {
        let app = XCUIApplication.cairn()
        app.launch()
        let probe = Probe(app: app)
        probe.wait("playing", "true", timeout: 10)
        let list = app.tables["player.list"]
        list.swipeUp()
        list.cells["player.station.4"].tap()
        probe.wait("index", "4")
        probe.wait("playing", "true")
        pause(app, probe)
        scrub(app, to: 0.985)
        play(app, probe)
        probe.wait("finished", "true", timeout: 12)
        showControls(app, probe)
        app.buttons["player.back"].tap()
        let card = app.cells[Self.bookCard]
        XCTAssertTrue(card.waitForExistence(timeout: 3))
        XCTAssertTrue(card.label.contains("Finished"), card.label)
    }

    func testAFreshInstallShowsTheBuiltInBookAndSettingsOpen() {
        let app = XCUIApplication.cairn(open: false)
        app.launch()
        let card = app.cells[Self.bookCard]
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        XCTAssertTrue(card.label.contains("The Art of War"))
        XCTAssertTrue(card.label.contains("Built-in"))
        XCTAssertTrue(card.label.contains("Not started"))
        app.buttons["shelf.settings"].tap()
        XCTAssertTrue(app.tables["settings.table"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.switches["settings.autoplay"].exists)
        app.cells["settings.acknowledgements"].tap()
        XCTAssertTrue(app.textViews["acknowledgements.text"].waitForExistence(timeout: 3))
    }

    func testABookFromICloudOffersRemovalAndAFailedRemovalChangesNothing() {
        let app = XCUIApplication.cairn(open: false)
        app.launchArguments += ["-CairnSeedSynced", "YES"]
        app.launch()
        let synced = app.cells["shelf.book.seeded-a1b2c3"]
        XCTAssertTrue(synced.waitForExistence(timeout: 5))

        synced.press(forDuration: 1.2)
        let remove = app.buttons["Remove from iCloud…"]
        XCTAssertTrue(remove.waitForExistence(timeout: 3))
        remove.tap()
        let confirm = app.alerts.firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 3))
        XCTAssertTrue(confirm.label.contains("The Art of War"))
        Self.shoot("remove-confirm")
        confirm.buttons["Remove"].tap()

        // This build has no iCloud, so the removal fails — and must leave the book where it was.
        let failed = app.alerts["Could not remove it"]
        XCTAssertTrue(failed.waitForExistence(timeout: 3))
        failed.buttons["OK"].tap()
        XCTAssertTrue(synced.exists)
    }

    func testABookWithACoverKeepsItsCardTheSizeOfAnyOther() {
        let app = XCUIApplication.cairn(open: false)
        app.launchArguments += ["-CairnSeedSynced", "YES"]
        app.launch()
        let withCover = app.cells["shelf.book.seeded-a1b2c3"]
        XCTAssertTrue(withCover.waitForExistence(timeout: 5))
        let plain = app.cells[Self.bookCard]
        XCTAssertTrue(plain.exists, "both cards fit on one screen")
        Self.shoot("cover-card")
        XCTAssertEqual(withCover.frame.height, plain.frame.height, accuracy: 1, "a cover fills its card; it does not size it")
        XCTAssertLessThan(withCover.frame.height, 200)
    }

    func testTheLanguageIsSwitchedInSettingsAndStaysSwitched() {
        var app = XCUIApplication.cairn(open: false)
        app.launch()
        app.buttons["shelf.settings"].tap()
        app.cells["settings.language"].tap()
        app.cells["language.zh-Hans"].tap()

        // Settings comes back on top, in the language just chosen.
        XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.staticTexts["自动播放下一章"].exists)
        Self.shoot("language-zh-settings")
        app.buttons["settings.done"].tap()
        XCTAssertTrue(app.staticTexts["书架"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.cells[Self.bookCard].label.contains("还没开始"))

        app.terminate()
        app = XCUIApplication.cairn(fresh: false, open: false)
        app.launch()
        XCTAssertTrue(app.staticTexts["书架"].waitForExistence(timeout: 5), "the choice outlives the launch")

        app.buttons["shelf.settings"].tap()
        app.cells["settings.language"].tap()
        app.cells["language.system"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 4), "the system here is in English")
    }

    private static func shoot(_ name: String) {
        guard let directory = ProcessInfo.processInfo.environment["CAIRN_SHOTS_DIR"], !directory.isEmpty else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation
            .write(to: URL(fileURLWithPath: directory).appendingPathComponent("\(name).png"))
    }
}
