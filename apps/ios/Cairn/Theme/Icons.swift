import UIKit

/// Glyphs the mock draws that SF Symbols has no match for, from the mock's own 24-unit paths.
enum Icons {
    static func symbol(_ name: String, size: CGFloat, weight: UIImage.SymbolWeight = .semibold) -> UIImage? {
        UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: size, weight: weight))
    }

    static func captions(size: CGFloat) -> UIImage {
        draw(size: size) { unit in
            let box = UIBezierPath(roundedRect: CGRect(x: 3 * unit, y: 5.5 * unit, width: 18 * unit, height: 13 * unit), cornerRadius: 2.6 * unit)
            let first = UIBezierPath(arcCenter: CGPoint(x: 9.7 * unit, y: 12 * unit), radius: 2.2 * unit, startAngle: -.pi / 4, endAngle: .pi / 4, clockwise: false)
            let second = UIBezierPath(arcCenter: CGPoint(x: 16.1 * unit, y: 12 * unit), radius: 2.2 * unit, startAngle: -.pi / 4, endAngle: .pi / 4, clockwise: false)
            return [box, first, second]
        }
    }

    static func fullscreen(size: CGFloat, exit: Bool) -> UIImage {
        draw(size: size) { unit in
            // Corners pointing out; for leaving, the same corners pointing in.
            let corners: [[CGPoint]] = exit
                ? [[(9, 4), (9, 9), (4, 9)], [(15, 4), (15, 9), (20, 9)], [(9, 20), (9, 15), (4, 15)], [(15, 20), (15, 15), (20, 15)]].map { $0.map { CGPoint(x: $0.0, y: $0.1) } }
                : [[(4, 9), (4, 4), (9, 4)], [(20, 9), (20, 4), (15, 4)], [(4, 15), (4, 20), (9, 20)], [(20, 15), (20, 20), (15, 20)]].map { $0.map { CGPoint(x: $0.0, y: $0.1) } }
            return corners.map { points in
                let path = UIBezierPath()
                for (index, point) in points.enumerated() {
                    let scaled = CGPoint(x: point.x * unit, y: point.y * unit)
                    if index == 0 { path.move(to: scaled) } else { path.addLine(to: scaled) }
                }
                return path
            }
        }
    }

    private static func draw(size: CGFloat, paths: (CGFloat) -> [UIBezierPath]) -> UIImage {
        let unit = size / 24
        let image = UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { _ in
            UIColor.black.setStroke()
            for path in paths(unit) {
                path.lineWidth = 1.8 * unit
                path.lineCapStyle = .round
                path.lineJoinStyle = .round
                path.stroke()
            }
        }
        return image.withRenderingMode(.alwaysTemplate)
    }
}
