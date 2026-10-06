import CairnKit
import Foundation

/// The words on a shelf card, from the book and where its reader is.
enum ShelfText {
    static func title(_ book: LibraryBook) -> String {
        switch book.content {
        case .readable(let manifest): manifest.title
        case .needsUpdate(let title): title ?? book.id
        }
    }

    /// `Sun Tzu · 5 chapters · 20 min`
    static func meta(_ book: LibraryBook) -> String? {
        guard let manifest = book.manifest else { return nil }
        let parts = [
            manifest.author,
            L10n.format("shelf.meta.chapters", manifest.path.nodes.count),
            L10n.minutes(manifest.minutes),
        ]
        return parts.compactMap { $0 }.joined(separator: " · ")
    }

    static func foot(_ foot: ShelfFoot) -> String {
        switch foot {
        case .needsUpdate: L10n.text("shelf.foot.needsUpdate")
        case .downloading(let have, let total): L10n.format("shelf.foot.downloading", have, total)
        case .notStarted: L10n.text("shelf.foot.notStarted")
        case .finished: L10n.text("shelf.foot.finished")
        case .progress(let chapter, let ms, _): L10n.format("shelf.foot.progress", chapter, L10n.clock(ms: ms))
        }
    }

    static func accessibilityLabel(_ book: LibraryBook) -> String {
        let builtIn = book.isBuiltIn ? L10n.text("shelf.builtIn") : nil
        return [title(book), builtIn, meta(book), foot(book.foot)].compactMap { $0 }.joined(separator: ", ")
    }
}
