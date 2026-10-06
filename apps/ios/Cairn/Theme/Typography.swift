import UIKit

/// The mock's point sizes, scaled by Dynamic Type. Nothing here reaches the slide, which is a web page.
enum Typography {
    static func font(_ size: CGFloat, _ weight: UIFont.Weight = .regular, relativeTo style: UIFont.TextStyle = .body) -> UIFont {
        UIFontMetrics(forTextStyle: style).scaledFont(for: .systemFont(ofSize: size, weight: weight))
    }

    /// Times and counts: digits of equal width, so a ticking number does not shiver.
    static func digits(_ size: CGFloat, _ weight: UIFont.Weight = .regular, relativeTo style: UIFont.TextStyle = .footnote) -> UIFont {
        UIFontMetrics(forTextStyle: style).scaledFont(for: .monospacedDigitSystemFont(ofSize: size, weight: weight))
    }
}

extension UILabel {
    convenience init(font: UIFont, color: UIColor, lines: Int = 1) {
        self.init()
        self.font = font
        textColor = color
        numberOfLines = lines
        adjustsFontForContentSizeCategory = true
    }
}
