import XCTest

/// Every screen, saved as PNGs for looking at. Skipped unless `CAIRN_SHOTS_DIR` is set
/// (pass `TEST_RUNNER_CAIRN_SHOTS_DIR` to xcodebuild); `CAIRN_LANG` picks the language.
@MainActor
final class ScreenshotUITests: XCTestCase {
    private var directory = ""
    private var prefix = ""

    override func setUp() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let dir = env["CAIRN_SHOTS_DIR"], !dir.isEmpty else { throw XCTSkip("CAIRN_SHOTS_DIR is not set") }
        directory = dir
        prefix = env["CAIRN_SHOTS_PREFIX"] ?? "shot"
        XCUIDevice.shared.orientation = .portrait
    }

    private var language: String { ProcessInfo.processInfo.environment["CAIRN_LANG"] ?? "en" }

    private func save(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        try? png.write(to: URL(fileURLWithPath: directory).appendingPathComponent("\(prefix)-\(name).png"))
    }

    func testEveryScreen() throws {
        var app = XCUIApplication.cairn(open: false, language: language)
        app.launch()
        XCTAssertTrue(app.cells["shelf.book.the-art-of-war-ed02db"].waitForExistence(timeout: 5))
        save("01-shelf")

        app.buttons["shelf.settings"].tap()
        XCTAssertTrue(app.tables["settings.table"].waitForExistence(timeout: 3))
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        save("02-settings")
        app.cells["settings.acknowledgements"].tap()
        XCTAssertTrue(app.textViews["acknowledgements.text"].waitForExistence(timeout: 3))
        save("03-acknowledgements")
        app.terminate()

        app = XCUIApplication.cairn(language: language)
        app.launch()
        let probe = Probe(app: app)
        probe.wait("playing", "true", timeout: 10)
        probe.wait("controls", "false", timeout: 6)
        RunLoop.current.run(until: Date().addingTimeInterval(9))
        save("04-player")

        let video = app.otherElements["player.video"]
        video.coordinate(withNormalizedOffset: CGVector(dx: 0.88, dy: 0.5)).doubleTap()
        video.coordinate(withNormalizedOffset: CGVector(dx: 0.88, dy: 0.5)).doubleTap()
        save("05-double-tap")
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))

        // The hold pill exists only while a finger is down; the caller shoots it from outside.
        try? Data().write(to: URL(fileURLWithPath: directory).appendingPathComponent("\(prefix)-hold.marker"))
        video.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 4)

        probe.wait("controls", "false", timeout: 6)
        video.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).tap()
        probe.wait("controls", "true", timeout: 3)
        app.buttons["player.playPause"].tap()
        probe.wait("playing", "false")
        save("06-controls-paused")

        app.buttons["player.sleep"].tap()
        XCTAssertTrue(app.cells["sleep.choice.5"].waitForExistence(timeout: 3))
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        save("07-sleep")
        app.cells["sleep.choice.2"].tap()
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        save("08-sleep-running")

        app.buttons["player.fullscreen"].tap()
        probe.wait("fullscreen", "true")
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        save("09-fullscreen-controls")
        app.buttons["player.chapters"].tap()
        XCTAssertTrue(app.tables["player.sheetList"].waitForExistence(timeout: 3))
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        save("10-fullscreen-chapters")
        app.tables["player.sheetList"].cells["player.station.1"].tap()
        probe.wait("index", "1")
        probe.wait("controls", "false", timeout: 6)
        RunLoop.current.run(until: Date().addingTimeInterval(4))
        save("11-fullscreen-playing")
        app.terminate()

        app = XCUIApplication.cairn(open: false, language: language)
        app.launchArguments += ["-CairnNoBuiltIn", "YES"]
        app.launch()
        XCTAssertTrue(app.buttons["shelf.checkAgain"].waitForExistence(timeout: 5))
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        save("12-empty")
    }
}
