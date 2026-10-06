import CairnKit
import Foundation

/// The language the interface is in: the system's, or one the reader picked in settings.
enum AppLanguage: String, CaseIterable {
    case system
    case english = "en"
    case chinese = "zh-Hans"

    private static let key = "app.language"
    /// The key iOS itself reads for an app's language.
    private static let systemKey = "AppleLanguages"

    static var chosen: AppLanguage {
        get { AppLanguage(rawValue: UserDefaults.standard.string(forKey: key) ?? "") ?? .system }
        set {
            UserDefaults.standard.set(newValue.rawValue, forKey: key)
            // What the system words itself — a formatter, a share sheet — follows this at the next launch.
            if newValue == .system {
                UserDefaults.standard.removeObject(forKey: systemKey)
            } else {
                UserDefaults.standard.set([newValue.rawValue], forKey: systemKey)
            }
        }
    }

    static func reset() {
        UserDefaults.standard.removeObject(forKey: key)
        UserDefaults.standard.removeObject(forKey: systemKey)
    }

    /// The localization in force right now, one of the two the app ships.
    static var code: String {
        switch chosen {
        case .system: (Locale.preferredLanguages.first ?? "en").hasPrefix("zh") ? chinese.rawValue : english.rawValue
        case .english, .chinese: chosen.rawValue
        }
    }

    /// A language is named in itself, so a reader who landed in the wrong one can find their way back.
    var name: String {
        switch self {
        case .system: L10n.text("settings.language.system")
        case .english: "English"
        case .chinese: "简体中文"
        }
    }

    fileprivate static var bundle: Bundle {
        Bundle.main.path(forResource: code, ofType: "lproj").flatMap(Bundle.init(path:)) ?? .main
    }
}

/// Every user-visible string goes through `Localizable.xcstrings`; nothing bakes a language into logic.
enum L10n {
    static func text(_ key: String) -> String {
        AppLanguage.bundle.localizedString(forKey: key, value: nil, table: nil)
    }

    static func format(_ key: String, _ arguments: CVarArg...) -> String {
        String(format: text(key), locale: Locale(identifier: AppLanguage.code), arguments: arguments)
    }

    /// `28 MB`, never the formatter's `Zero KB`.
    static func bytes(_ count: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        formatter.allowsNonnumericFormatting = false
        return formatter.string(fromByteCount: Int64(count))
    }

    /// `2:05`, and `1:02:05` past the hour.
    static func clock(ms: Int) -> String {
        let total = max(0, ms) / 1000
        let (hours, minutes, seconds) = (total / 3600, (total % 3600) / 60, total % 60)
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, seconds)
            : String(format: "%d:%02d", minutes, seconds)
    }

    static func minutes(_ value: Double) -> String {
        format("unit.minutes", Int(max(1, value.rounded())))
    }

    static func minutes(ms: Int) -> String {
        minutes(Double(ms) / 60_000)
    }

    static func account(_ account: CloudAccount) -> String {
        switch account {
        case .available: text("cloud.account.available")
        case .noAccount: text("cloud.account.noAccount")
        case .restricted: text("cloud.account.restricted")
        case .temporarilyUnavailable: text("cloud.account.temporarilyUnavailable")
        case .unknown: text("cloud.account.unknown")
        }
    }
}
