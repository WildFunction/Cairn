import XCTest

/// The player's gestures and controls, on the built-in book, with the sound off.
@MainActor
final class PlayerUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() async throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app = XCUIApplication.cairn()
        app.launch()
        XCTAssertTrue(probe.element.waitForExistence(timeout: 10))
    }

    override func tearDown() async throws {
        XCUIDevice.shared.orientation = .portrait
    }

    private var probe: Probe { Probe(app: app) }
    private var video: XCUIElement { app.otherElements["player.video"] }
    private var playPause: XCUIElement { app.buttons["player.playPause"] }

    private func state(_ key: String) -> String { probe.state(key) }
    private func positionMs() -> Int { probe.ms() }
    private func waitFor(_ key: String, _ value: String, timeout: TimeInterval = 6, line: UInt = #line) {
        probe.wait(key, value, timeout: timeout, line: line)
    }

    /// The probe flips with the layout; the window's frame finishes rotating a moment later.
    private func waitForWindow(landscape: Bool, line: UInt = #line) {
        let deadline = Date().addingTimeInterval(4)
        while Date() < deadline {
            let frame = app.windows.firstMatch.frame
            if (frame.width > frame.height) == landscape { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTFail("the window never turned \(landscape ? "landscape" : "portrait")", line: line)
    }

    private func waitForLabel(_ element: XCUIElement, _ label: String) {
        let matched = expectation(for: NSPredicate(format: "label == %@", label), evaluatedWith: element)
        wait(for: [matched], timeout: 3)
    }

    /// Pauses through the controls, which then stay up. Waits for them to settle hidden first,
    /// so the auto-hide cannot take them away between the tap that shows them and the next one.
    private func pause() {
        waitFor("controls", "false", timeout: 6)
        showControls()
        playPause.tap()
        waitFor("playing", "false")
    }

    private func showControls() {
        if state("controls") == "false" { video.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).tap() }
        waitFor("controls", "true", timeout: 3)
    }

    func testATapShowsTheControlsAndTheyLeaveOnTheirOwn() {
        waitFor("playing", "true")
        waitFor("controls", "false", timeout: 6)
        XCTAssertFalse(playPause.isHittable)

        video.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.3)).tap()
        waitFor("controls", "true", timeout: 3)
        XCTAssertTrue(playPause.isHittable)
        waitFor("controls", "false", timeout: 6)
    }

    func testPausedControlsStay() {
        waitFor("playing", "true")
        pause()
        RunLoop.current.run(until: Date().addingTimeInterval(4))
        XCTAssertEqual(state("controls"), "true")
        XCTAssertTrue(playPause.isHittable)
    }

    func testADoubleTapOnTheRightMovesTenSecondsAndOnTheLeftBack() {
        waitFor("playing", "true")
        pause()
        let before = positionMs()
        video.coordinate(withNormalizedOffset: CGVector(dx: 0.88, dy: 0.5)).doubleTap()
        RunLoop.current.run(until: Date().addingTimeInterval(0.6))
        XCTAssertEqual(positionMs() - before, 10_000)

        // Two more in a row, inside the window, count on from the first of them.
        video.coordinate(withNormalizedOffset: CGVector(dx: 0.88, dy: 0.5)).doubleTap()
        video.coordinate(withNormalizedOffset: CGVector(dx: 0.88, dy: 0.5)).doubleTap()
        let arc = app.otherElements["player.seekArc.forward"]
        XCTAssertEqual(arc.value as? String, "20 s", "taps in a row add up")
        RunLoop.current.run(until: Date().addingTimeInterval(0.6))
        XCTAssertEqual(positionMs() - before, 30_000)

        video.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.5)).doubleTap()
        RunLoop.current.run(until: Date().addingTimeInterval(0.6))
        XCTAssertEqual(positionMs() - before, 20_000)
    }

    func testALongPressPlaysAtTwiceAndReleaseRestoresTheSpeed() {
        waitFor("playing", "true")
        waitFor("controls", "false", timeout: 6)
        video.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 1.5)
        XCTAssertEqual(state("lastHold"), "2.0")
        waitFor("rate", "1.0", timeout: 2)
        XCTAssertEqual(state("controls"), "false", "a hold is not also a tap")
    }

    private func swipeFromTheLeftEdge() {
        let window = app.windows.firstMatch
        let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.6)).withOffset(CGVector(dx: 2, dy: 0))
        start.press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.6)))
    }

    func testASwipeFromTheLeftEdgeGoesBackToTheShelf() {
        swipeFromTheLeftEdge()
        XCTAssertTrue(app.buttons["shelf.settings"].waitForExistence(timeout: 4))
        XCTAssertFalse(probe.element.exists)
    }

    func testInFullScreenTheEdgeSwipeDoesNotLeaveThePlayer() {
        video.tap()
        app.buttons["player.fullscreen"].tap()
        waitFor("fullscreen", "true")
        waitForWindow(landscape: true)
        swipeFromTheLeftEdge()
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        XCTAssertTrue(probe.element.exists)
        XCTAssertEqual(state("fullscreen"), "true")
    }

    func testTheFullScreenButtonTurnsToLandscapeAndTheChevronTurnsBack() {
        waitFor("playing", "true")
        pause()
        app.buttons["player.fullscreen"].tap()
        waitFor("fullscreen", "true")
        waitForWindow(landscape: true)

        app.buttons["player.back"].tap()
        waitFor("fullscreen", "false")
        waitForWindow(landscape: false)
    }

    func testAfterTheButtonForcedLandscapeTurningThePhoneStillTurnsItBack() {
        waitFor("playing", "true")
        pause()
        app.buttons["player.fullscreen"].tap()
        waitFor("fullscreen", "true")
        XCUIDevice.shared.orientation = .landscapeLeft
        waitFor("fullscreen", "true")
        XCUIDevice.shared.orientation = .portrait
        waitFor("fullscreen", "false")
    }

    func testTurningThePhoneGoesFullScreenAndBack() {
        waitFor("playing", "true")
        XCUIDevice.shared.orientation = .landscapeLeft
        waitFor("fullscreen", "true")
        XCUIDevice.shared.orientation = .portrait
        waitFor("fullscreen", "false")
    }

    func testTheChaptersSheetInFullScreenPlaysAnotherStation() {
        waitFor("playing", "true")
        pause()
        app.buttons["player.fullscreen"].tap()
        waitFor("fullscreen", "true")
        showControls()
        app.buttons["player.chapters"].tap()
        let list = app.tables["player.sheetList"]
        XCTAssertTrue(list.waitForExistence(timeout: 3))
        list.cells["player.station.2"].tap()
        waitFor("index", "2")
        waitFor("playing", "true")
    }

    func testPickingAStationFromTheListPlaysIt() {
        waitFor("playing", "true")
        app.tables["player.list"].cells["player.station.1"].tap()
        waitFor("index", "1")
        waitFor("playing", "true")
    }

    func testSpeedAndCaptionsAreChosenFromTheControls() {
        waitFor("playing", "true")
        pause()
        app.buttons["player.rate"].tap()
        app.buttons["1.5×"].tap()
        waitFor("rate", "1.5")
        XCTAssertTrue(app.buttons["1.5×"].waitForNonExistence(timeout: 2), "the menu has closed")
        let captions = app.buttons["player.captions"]
        captions.tap()
        waitForLabel(captions, "Captions, off")
        captions.tap()
        waitForLabel(captions, "Captions, on")
        app.buttons["player.rate"].tap()
        app.buttons["1×"].tap()
        waitFor("rate", "1.0")
    }

    func testTheSleepTimerSheetSetsEndOfChapter() {
        waitFor("playing", "true")
        pause()
        app.buttons["player.sleep"].tap()
        let choice = app.cells["sleep.choice.5"]
        XCTAssertTrue(choice.waitForExistence(timeout: 3))
        choice.tap()
        waitFor("sleep", "endOfChapter")
    }

    func testSoundContinuesInTheBackgroundAndTheLockScreenKnowsTheStation() {
        waitFor("playing", "true")
        XCTAssertEqual(probe.element.label, "Assessing conditions and preparing to win")
        XCTAssertEqual(state("idle"), "off", "the screen does not dim while a station plays")
        let before = positionMs()
        XCUIDevice.shared.press(.home)
        RunLoop.current.run(until: Date().addingTimeInterval(6))
        app.activate()
        XCTAssertTrue(probe.element.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(positionMs() - before, 5000)
        XCTAssertEqual(state("playing"), "true")
    }
}
