import CairnKit
import Foundation

/// The player's words, from the model's numbers.
enum PlayerText {
    static func rate(_ rate: Double) -> String {
        let number = rate.formatted(.number.precision(.fractionLength(0...2)))
        return L10n.format("player.rate", number)
    }

    /// `The Art of War · Chapter 2 · 4 min`
    static func meta(book: String, index: Int, durationMs: Int) -> String {
        L10n.format("player.meta", book, index + 1, L10n.minutes(ms: durationMs))
    }

    static func chaptersCount(index: Int, total: Int, totalMs: Int) -> String {
        L10n.format("player.chapters.count", index + 1, total, L10n.minutes(ms: totalMs))
    }

    static func time(_ ms: Int, of durationMs: Int) -> String {
        "\(L10n.clock(ms: ms)) / \(L10n.clock(ms: durationMs))"
    }

    static func sleepChoice(_ mode: SleepTimer.Mode) -> String {
        switch mode {
        case .off: L10n.text("sleep.off")
        case .minutes(60): L10n.text("sleep.hour")
        case .minutes(let minutes): L10n.minutes(Double(minutes))
        case .endOfChapter: L10n.text("sleep.endOfChapter")
        }
    }
}
