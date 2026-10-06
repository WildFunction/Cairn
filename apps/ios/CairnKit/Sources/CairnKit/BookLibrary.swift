import Foundation
import os

public enum LibraryError: Error, Equatable {
    /// A book or record name that could not have come from the Mac, and would leave the library if joined.
    case unsafeName(String)
}

/// The books on this device: `books/<id>/` under a writable root, laid out as on the Mac, plus an
/// optional read-only root with the same layout (the app bundle's built-in book).
public final class BookLibrary: @unchecked Sendable {
    public static let manifestFile = "manifest.json"
    public static let stateFile = "state.json"

    private let root: URL
    private let builtIn: URL?
    private let lock = NSLock()
    private let files = FileManager.default
    private let log = Logger(subsystem: "dev.jasper.cairn", category: "library")

    public init(root: URL, builtIn: URL? = nil) {
        self.root = root
        self.builtIn = builtIn
    }

    // MARK: Reading

    /// Synced books newest first, then the built-in one.
    public func books() -> [LibraryBook] {
        let ids = Set(bookIds(in: root)).union(builtIn.map(bookIds(in:)) ?? [])
        return ids.compactMap(book).sorted { a, b in
            if a.isBuiltIn != b.isBuiltIn { return b.isBuiltIn }
            let (left, right) = (a.manifest?.path.generatedAt ?? "", b.manifest?.path.generatedAt ?? "")
            return left == right ? a.id < b.id : left > right
        }
    }

    /// The synced copy once it is whole; until then the built-in copy of the same book, if there is one.
    public func book(_ id: String) -> LibraryBook? {
        guard Self.isBookId(id) else { return nil }
        let synced = read(id, under: root, isBuiltIn: false)
        let bundled = builtIn.flatMap { read(id, under: $0, isBuiltIn: true) }
        if let synced, synced.isComplete || bundled == nil { return synced }
        return bundled ?? synced
    }

    /// The deck file's text, verbatim: the slide page parses it, Swift never does.
    public func deckText(of book: LibraryBook, nodeId: String) throws -> String {
        try String(contentsOf: directory(of: book).appending(path: "decks/\(nodeId).json"), encoding: .utf8)
    }

    public func audioURL(of book: LibraryBook, nodeId: String) -> URL {
        directory(of: book).appending(path: "audio/\(nodeId).mp3")
    }

    public func state(of id: String) -> BookState {
        guard Self.isBookId(id) else { return .empty }
        return lock.withLock { readState(id) }
    }

    /// Whether iCloud has delivered this book, as opposed to it only shipping with the app.
    public func isSynced(_ id: String) -> Bool {
        Self.isBookId(id) && files.fileExists(atPath: bookDirectory(id, under: root).appending(path: Self.manifestFile).path)
    }

    public func bytesUsed() -> Int { bytes(under: root) }

    /// What the synced copy of one book takes on this device.
    public func bytesUsed(by id: String) -> Int {
        Self.isBookId(id) ? bytes(under: bookDirectory(id, under: root)) : 0
    }

    private func bytes(under directory: URL) -> Int {
        guard let walker = files.enumerator(at: directory, includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
        var total = 0
        for case let file as URL in walker {
            total += (try? file.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
        }
        return total
    }

    // MARK: Writing

    @discardableResult
    public func updateState(of id: String, _ change: (BookState) -> BookState) throws -> BookState {
        try Self.requireBookId(id)
        return try lock.withLock {
            let next = change(readState(id))
            try writeState(next, id)
            return next
        }
    }

    /// `audio` is copied, not moved: the file belongs to whoever downloaded it.
    public func writeStation(bookId: String, nodeId: String, deck: String, audio: URL, fingerprint: String) throws {
        try Self.requireBookId(bookId)
        try Self.requireRecordName(nodeId)
        try lock.withLock {
            let directory = bookDirectory(bookId, under: root)
            let deckFile = directory.appending(path: "decks/\(nodeId).json")
            let audioFile = directory.appending(path: "audio/\(nodeId).mp3")
            try files.createDirectory(at: deckFile.deletingLastPathComponent(), withIntermediateDirectories: true)
            try files.createDirectory(at: audioFile.deletingLastPathComponent(), withIntermediateDirectories: true)
            // The deck goes first and comes back last, so a half-replaced station is absent, never mismatched.
            try removeIfPresent(deckFile)
            try removeIfPresent(audioFile)
            try files.copyItem(at: audio, to: audioFile)
            try Data(deck.utf8).write(to: deckFile, options: .atomic)
            let state = readState(bookId)
            try writeState(state.with(stations: state.stations.merging([nodeId: fingerprint]) { _, new in new }), bookId)
        }
    }

    public func writeBook(bookId: String, manifest: String, cover: URL?, fingerprint: String) throws {
        try Self.requireBookId(bookId)
        try lock.withLock {
            let directory = bookDirectory(bookId, under: root)
            try files.createDirectory(at: directory, withIntermediateDirectories: true)
            for old in coverFiles(in: directory) { try removeIfPresent(old) }
            if let cover {
                let ext = cover.pathExtension.isEmpty ? "jpg" : cover.pathExtension.lowercased()
                try files.copyItem(at: cover, to: directory.appending(path: "cover.\(ext)"))
            }
            try Data(manifest.utf8).write(to: directory.appending(path: Self.manifestFile), options: .atomic)
            try writeState(readState(bookId).with(book: .some(fingerprint)), bookId)
        }
    }

    public func removeStation(bookId: String, nodeId: String) throws {
        try Self.requireBookId(bookId)
        try Self.requireRecordName(nodeId)
        try lock.withLock {
            let directory = bookDirectory(bookId, under: root)
            try removeIfPresent(directory.appending(path: "decks/\(nodeId).json"))
            try removeIfPresent(directory.appending(path: "audio/\(nodeId).mp3"))
            let state = readState(bookId)
            try writeState(state.with(stations: state.stations.filter { $0.key != nodeId }), bookId)
        }
    }

    /// Takes the reader's place with it: the book is gone from iCloud, and a re-push is a new path.
    public func removeBook(_ id: String) throws {
        try Self.requireBookId(id)
        try lock.withLock { try removeIfPresent(bookDirectory(id, under: root)) }
    }

    // MARK: Names

    /// What `bookSlug` on the Mac can produce.
    public static func isBookId(_ value: String) -> Bool {
        value.wholeMatch(of: /[a-z0-9][a-z0-9-]{0,63}/) != nil
    }

    public static func isRecordName(_ value: String) -> Bool {
        value.wholeMatch(of: /[A-Za-z0-9_-]{1,64}/) != nil
    }

    private static func requireBookId(_ value: String) throws {
        guard isBookId(value) else { throw LibraryError.unsafeName(value) }
    }

    private static func requireRecordName(_ value: String) throws {
        guard isRecordName(value) else { throw LibraryError.unsafeName(value) }
    }

    // MARK: Disk

    private func bookDirectory(_ id: String, under base: URL) -> URL {
        base.appending(path: "books/\(id)", directoryHint: .isDirectory)
    }

    private func directory(of book: LibraryBook) -> URL {
        bookDirectory(book.id, under: book.isBuiltIn ? (builtIn ?? root) : root)
    }

    private func bookIds(in base: URL) -> [String] {
        let names = (try? files.contentsOfDirectory(atPath: base.appending(path: "books").path)) ?? []
        return names.filter { name in
            Self.isBookId(name)
                && files.fileExists(atPath: bookDirectory(name, under: base).appending(path: Self.manifestFile).path)
        }
    }

    private func read(_ id: String, under base: URL, isBuiltIn: Bool) -> LibraryBook? {
        let directory = bookDirectory(id, under: base)
        guard let data = try? Data(contentsOf: directory.appending(path: Self.manifestFile)) else { return nil }
        let state = lock.withLock { readState(id) }
        let decoder = JSONDecoder()

        let header: ManifestHeader
        do {
            header = try decoder.decode(ManifestHeader.self, from: data)
        } catch {
            log.error("manifest of \(id, privacy: .public) is unreadable: \(error.localizedDescription, privacy: .public)")
            return nil
        }
        if header.format > SyncedBook.supportedFormat {
            return LibraryBook(
                id: id, isBuiltIn: isBuiltIn, content: .needsUpdate(title: header.title), cover: nil, stations: [],
                state: state)
        }

        let manifest: SyncedBook
        do {
            manifest = try decoder.decode(SyncedBook.self, from: data)
        } catch {
            log.error("manifest of \(id, privacy: .public) does not decode: \(String(describing: error), privacy: .public)")
            return nil
        }
        let stations = manifest.path.nodes.map { node -> StationFile in
            let deck = directory.appending(path: "decks/\(node.id).json")
            let audio = directory.appending(path: "audio/\(node.id).mp3")
            guard files.fileExists(atPath: audio.path), let text = try? Data(contentsOf: deck),
                  let summary = try? decoder.decode(DeckSummary.self, from: text)
            else { return StationFile(nodeId: node.id, durationMs: nil, isOnDisk: false) }
            return StationFile(nodeId: node.id, durationMs: summary.durationMs, isOnDisk: true)
        }
        return LibraryBook(
            id: id, isBuiltIn: isBuiltIn, content: .readable(manifest), cover: coverFiles(in: directory).first,
            stations: stations, state: state)
    }

    private func coverFiles(in directory: URL) -> [URL] {
        let names = (try? files.contentsOfDirectory(atPath: directory.path)) ?? []
        return names.filter { $0.hasPrefix("cover.") }.sorted().map { directory.appending(path: $0) }
    }

    private func readState(_ id: String) -> BookState {
        let file = bookDirectory(id, under: root).appending(path: Self.stateFile)
        guard let data = try? Data(contentsOf: file) else { return .empty }
        do {
            return try JSONDecoder().decode(BookState.self, from: data)
        } catch {
            log.error("state of \(id, privacy: .public) is unreadable, starting over: \(error.localizedDescription, privacy: .public)")
            return .empty
        }
    }

    private func writeState(_ state: BookState, _ id: String) throws {
        let directory = bookDirectory(id, under: root)
        try files.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(state).write(to: directory.appending(path: Self.stateFile), options: .atomic)
    }

    private func removeIfPresent(_ url: URL) throws {
        guard files.fileExists(atPath: url.path) else { return }
        try files.removeItem(at: url)
    }
}
