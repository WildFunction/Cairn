import CairnKit
import os
import UIKit

/// The one place process-long objects are built. Everything else is handed what it needs.
@MainActor
final class AppEnvironment {
    let library: BookLibrary
    let cloud: CloudBooks
    let options: LaunchOptions
    let preferences: PreferenceStore = UserPreferences()
    /// One for the process: the lock screen's commands are registered once, not per book opened.
    private(set) lazy var engine: AudioEngine = SwiftAudioEngine(gain: options.muted ? 0 : 1)
    private weak var activePlayer: PlayerModel?

    init(options: LaunchOptions = .current) {
        self.options = options
        let root = URL.applicationSupportDirectory.appending(path: "Library", directoryHint: .isDirectory)
        #if DEBUG
        if options.fresh {
            try? FileManager.default.removeItem(at: root)
            UserPreferences().reset()
            AppLanguage.reset()
        }
        #endif
        Self.keepOutOfBackups(root)
        let builtIn = options.hidesBuiltInBook ? nil : Bundle.main.url(forResource: "SampleBook", withExtension: nil)
        #if DEBUG
        if options.seedsSyncedBook { Self.seedSyncedBook(under: root) }
        #endif
        let library = BookLibrary(root: root, builtIn: builtIn)
        self.library = library
        let receiver = LibrarySync(library: library) { _ in
            DispatchQueue.main.async { NotificationCenter.default.post(name: .cairnLibraryDidChange, object: nil) }
        }
        cloud = Self.canUseCloudKit
            ? CloudKitBooks(library: library, receiver: receiver, stateFile: root.appending(path: "sync-state.json"))
            : NoCloud()
    }

    private static var canUseCloudKit: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "CairnSigned") as? String) != "NO"
    }

    var isCloudEnabled: Bool { !(cloud is NoCloud) }

    func refreshFromCloud() async {
        do {
            try await cloud.fetchChanges()
        } catch {
            log.error("fetching from iCloud failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Out of iCloud and off this phone; the Mac notices and stops syncing it.
    func removeFromCloud(_ bookId: String) async throws {
        try await cloud.remove(bookId: bookId)
    }

    func makePlayer(for book: LibraryBook) -> UIViewController? {
        guard book.canOpen else { return nil }
        let model = PlayerModel(
            book: book, library: library, engine: engine, clock: SystemClock(), preferences: preferences,
            device: UIDevice.current.model)
        model.onSendPlace = { [cloud, library] place in
            guard library.isSynced(book.id) else { return }
            // The last place is written as the app leaves the screen; this keeps it alive long enough to arrive.
            let hold = BackgroundHold(name: "send place")
            Task {
                await cloud.send(progress: place, bookId: book.id)
                hold.end()
            }
        }
        activePlayer = model
        return PlayerViewController(model: model, library: library)
    }

    func didEnterBackground() {
        activePlayer?.didEnterBackground()
    }

    func makeSettings() -> UIViewController {
        UINavigationController(rootViewController: SettingsViewController(environment: self))
    }

    private let log = Logger(subsystem: "dev.jasper.cairn", category: "app")

    #if DEBUG
    static let seededBookId = "seeded-a1b2c3"

    /// A copy of the built-in book where iCloud would have put one, so a UI test has a synced book to act on.
    private static func seedSyncedBook(under root: URL) {
        guard let sample = Bundle.main.url(forResource: "SampleBook", withExtension: nil) else { return }
        let target = root.appending(path: "books/\(seededBookId)")
        guard !FileManager.default.fileExists(atPath: target.path) else { return }
        try? FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.copyItem(at: sample.appending(path: "books/the-art-of-war-ed02db"), to: target)
        // A cover the size real ones are: far larger than the card that shows it.
        let size = CGSize(width: 1200, height: 1800)
        let cover = UIGraphicsImageRenderer(size: size).image { context in
            UIColor(hex: 0xB03A0B).setFill()
            context.fill(CGRect(origin: .zero, size: size))
            UIColor.white.setFill()
            context.fill(CGRect(x: 0, y: 700, width: 1200, height: 400))
        }
        try? cover.jpegData(compressionQuality: 0.8)?.write(to: target.appending(path: "cover.jpg"))
    }
    #endif

    /// Everything under the root comes back from iCloud, so it has no business in a device backup.
    private static func keepOutOfBackups(_ root: URL) {
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var target = root
            try target.setResourceValues(values)
        } catch {
            Logger(subsystem: "dev.jasper.cairn", category: "app")
                .error("could not prepare the library directory: \(error.localizedDescription, privacy: .public)")
        }
    }
}

/// A little background time, given back when the work finishes or when the system says time is up.
/// A hold that is never ended gets the whole app terminated, so the expiry ends it too.
@MainActor
private final class BackgroundHold {
    private var id = UIBackgroundTaskIdentifier.invalid

    init(name: String) {
        id = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in self?.end() }
    }

    func end() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
        id = .invalid
    }
}

/// Switches a UI test or a screenshot run passes as `-CairnName YES`. Compiled out of Release.
struct LaunchOptions {
    var hidesBuiltInBook = false
    /// As if just installed: no synced books, no places, no remembered choices.
    var fresh = false
    var muted = false
    /// A book to open as soon as the shelf appears.
    var openBook: String?
    /// Put a book in the library as if iCloud had delivered it.
    var seedsSyncedBook = false

    static var current: LaunchOptions {
        #if DEBUG
        let defaults = UserDefaults.standard
        return LaunchOptions(
            hidesBuiltInBook: defaults.bool(forKey: "CairnNoBuiltIn"),
            fresh: defaults.bool(forKey: "CairnFresh"),
            muted: defaults.bool(forKey: "CairnMuted"),
            openBook: defaults.string(forKey: "CairnOpenBook"),
            seedsSyncedBook: defaults.bool(forKey: "CairnSeedSynced"))
        #else
        return LaunchOptions()
        #endif
    }
}
