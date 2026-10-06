import CairnKit
import Foundation

/// The player's remembered choices, in `UserDefaults`: they belong to this phone, not to a book.
final class UserPreferences: PreferenceStore {
    private static let key = "player.preferences"
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    func reset() { defaults.removeObject(forKey: Self.key) }

    var player: PlayerPreferences {
        get {
            guard let data = defaults.data(forKey: Self.key),
                  let stored = try? JSONDecoder().decode(PlayerPreferences.self, from: data)
            else { return PlayerPreferences() }
            return stored
        }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: Self.key) }
    }
}
