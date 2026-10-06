import UIKit

/// `packages/ui/src/tokens.css`, as colours that follow the system appearance. Re-measure the
/// contrast tables in docs/DESIGN.md before changing a value in either file.
enum Palette {
    static let page = dynamic(0xF4F4F7, 0x0E0E10)
    static let chrome = dynamic(0xE7E7EC, 0x0A0A0C)
    static let card = dynamic(0xFFFFFF, 0x1A1A1E)
    static let ink = dynamic(0x1C1C1E, 0xECECF0)
    static let inkQuiet = dynamic(0x3A3A3E, 0xC6C6CD)
    static let dim = dynamic(0x616168, 0x8D8D96)
    static let line = dynamic(0xDCDCE2, 0x26262B)
    static let accent = dynamic(0xB03A0B, 0xF0A44F)
    static let soft = dynamic(0xFBEADF, 0x3A2415)
    static let done = dynamic(0x3F7D37, 0x7FB36F)
    static let lock = dynamic(0xC6C6CC, 0x45454B)
    static let onAccent = dynamic(0xFFFFFF, 0x1C1C1E)

    /// The slide is dark in both appearances, so what sits on it does not follow the system.
    static let stage = UIColor(hex: 0x211E18)
    static let stageInk = UIColor(hex: 0xF8F6F2)
    static let stageDim = UIColor(hex: 0xA5A099)
    static let stageAccent = UIColor(hex: 0xF0A44F)
    static let stageScrim = UIColor(hex: 0x0F0D0A)

    private static func dynamic(_ light: UInt32, _ dark: UInt32) -> UIColor {
        UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) }
    }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }
}
