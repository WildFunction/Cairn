import XCTest

/// The player's Debug-only accessibility probe, read as key=value pairs.
@MainActor
struct Probe {
    let app: XCUIApplication

    var element: XCUIElement { app.otherElements["player.probe"] }

    func state(_ key: String) -> String {
        let value = element.value as? String ?? ""
        let pair = value.split(separator: " ").first { $0.hasPrefix("\(key)=") }
        return pair.map { String($0.dropFirst(key.count + 1)) } ?? ""
    }

    func ms() -> Int { Int(state("ms")) ?? -1 }

    func wait(_ key: String, _ value: String, timeout: TimeInterval = 6, file: StaticString = #filePath, line: UInt = #line) {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if state(key) == value { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTFail("\(key) never became \(value); probe says \(element.value ?? "nothing")", file: file, line: line)
    }
}

extension XCUIApplication {
    static func cairn(fresh: Bool = true, open: Bool = true, language: String = "en") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-CairnMuted", "YES", "-AppleLanguages", "(\(language))"]
        if fresh { app.launchArguments += ["-CairnFresh", "YES"] }
        if open { app.launchArguments += ["-CairnOpenBook", "the-art-of-war-ed02db"] }
        return app
    }
}
