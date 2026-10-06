import SnapKit
import UIKit

/// A book's cover, or its title on a plain board with an accent spine when it has none.
final class CoverView: UIView {
    private let imageView = UIImageView()
    private let spine = UIView()
    private let titleLabel = UILabel(font: Typography.font(12, .semibold, relativeTo: .caption1), color: Palette.ink, lines: 5)

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = Palette.soft
        clipsToBounds = true

        imageView.contentMode = .scaleAspectFill
        // An image view asks to be its image's own size, and a cover is a thousand points tall:
        // left alone it sized the whole card. The card sizes the cover, never the other way round.
        for axis in [NSLayoutConstraint.Axis.horizontal, .vertical] {
            imageView.setContentCompressionResistancePriority(.init(1), for: axis)
            imageView.setContentHuggingPriority(.init(1), for: axis)
        }
        spine.backgroundColor = Palette.accent
        titleLabel.textAlignment = .center

        addSubview(titleLabel)
        addSubview(spine)
        addSubview(imageView)
        imageView.snp.makeConstraints { $0.edges.equalToSuperview() }
        spine.snp.makeConstraints { make in
            make.leading.top.bottom.equalToSuperview()
            make.width.equalTo(4)
        }
        titleLabel.snp.makeConstraints { make in
            make.leading.equalToSuperview().inset(12)
            make.trailing.equalToSuperview().inset(8)
            make.centerY.equalToSuperview()
            make.top.greaterThanOrEqualToSuperview().inset(10)
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// Scaled to cover the card's cover area at this screen's density, keeping its shape.
    private static func thumbnail(_ image: UIImage) -> UIImage {
        let pixels = UITraitCollection.current.displayScale
        let wanted = CGSize(width: thumbnailPoints.width * pixels, height: thumbnailPoints.height * pixels)
        let have = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        guard have.width > 0, have.height > 0 else { return image }
        let ratio = max(wanted.width / have.width, wanted.height / have.height)
        guard ratio < 1 else { return image }
        let size = CGSize(width: have.width * ratio / pixels, height: have.height * ratio / pixels)
        return image.preparingThumbnail(of: size) ?? image
    }

    /// Covers arrive at print size; a card shows them at a hundred points.
    private static let thumbnailPoints = CGSize(width: 100, height: 136)

    func show(cover: URL?, title: String) {
        let image = cover.flatMap { UIImage(contentsOfFile: $0.path) }.map(Self.thumbnail)
        imageView.image = image
        imageView.isHidden = image == nil
        titleLabel.text = title
    }
}
