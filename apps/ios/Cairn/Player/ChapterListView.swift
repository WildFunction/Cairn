import CairnKit
import SnapKit
import UIKit

/// Below the slide in portrait, and alone in the full-screen sheet: the station's title and brief,
/// then every station grouped under its stage.
final class ChapterListView: UITableView, UITableViewDataSource, UITableViewDelegate {
    enum Row: Equatable {
        case info, head
        case stage(String)
        case station(Int)
    }

    var onSelect: ((Int) -> Void)?
    private let showsInfo: Bool
    private var rows: [Row] = []
    private weak var model: PlayerModel?
    private var briefExpanded = false
    private var shownIndex = -1

    init(showsInfo: Bool) {
        self.showsInfo = showsInfo
        super.init(frame: .zero, style: .plain)
        dataSource = self
        delegate = self
        separatorStyle = .none
        backgroundColor = showsInfo ? Palette.page : Palette.card
        contentInset.bottom = 24
        register(InfoCell.self, forCellReuseIdentifier: "info")
        register(HeadCell.self, forCellReuseIdentifier: "head")
        register(StageCell.self, forCellReuseIdentifier: "stage")
        register(StationCell.self, forCellReuseIdentifier: "station")
        accessibilityIdentifier = showsInfo ? "player.list" : "player.sheetList"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(_ model: PlayerModel) {
        self.model = model
        if model.index != shownIndex { briefExpanded = false }
        shownIndex = model.index
        var next: [Row] = showsInfo ? [.info, .head] : []
        let stages = model.book.manifest?.path.stages ?? []
        var placed = Set<String>()
        for stage in stages {
            next.append(.stage(stage.title))
            for id in stage.nodeIds {
                guard let index = model.nodes.firstIndex(where: { $0.id == id }) else { continue }
                next.append(.station(index))
                placed.insert(id)
            }
        }
        // A station no stage names is still listed rather than lost.
        for (index, node) in model.nodes.enumerated() where !placed.contains(node.id) { next.append(.station(index)) }
        rows = next
        reloadData()
    }

    func scrollToCurrent(animated: Bool) {
        guard let model, let row = rows.firstIndex(of: .station(model.index)) else { return }
        scrollToRow(at: IndexPath(row: row, section: 0), at: .middle, animated: animated)
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { rows.count }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        guard let model, let row = rows[safe: indexPath.row] else { return UITableViewCell() }
        switch row {
        case .info:
            let cell = dequeue(InfoCell.self, "info", indexPath)
            cell.show(model: model, expanded: briefExpanded) { [weak self] in
                self?.briefExpanded.toggle()
                self?.reloadRows(at: [indexPath], with: .none)
            }
            return cell
        case .head:
            let cell = dequeue(HeadCell.self, "head", indexPath)
            let total = model.book.stations.indices.reduce(0) { $0 + model.book.durationMs(at: $1) }
            cell.show(count: PlayerText.chaptersCount(index: model.index, total: model.nodes.count, totalMs: total))
            return cell
        case .stage(let title):
            let cell = dequeue(StageCell.self, "stage", indexPath)
            cell.show(title: title, background: backgroundColor)
            return cell
        case .station(let index):
            let cell = dequeue(StationCell.self, "station", indexPath)
            cell.show(model: model, index: index, background: backgroundColor)
            return cell
        }
    }

    func tableView(_ tableView: UITableView, shouldHighlightRowAt indexPath: IndexPath) -> Bool {
        guard case .station(let index) = rows[safe: indexPath.row], let model else { return false }
        return model.isOnDisk(index)
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard case .station(let index) = rows[safe: indexPath.row] else { return }
        onSelect?(index)
    }

    private func dequeue<Cell: UITableViewCell>(_ type: Cell.Type, _ id: String, _ indexPath: IndexPath) -> Cell {
        (dequeueReusableCell(withIdentifier: id, for: indexPath) as? Cell) ?? Cell()
    }
}

private final class InfoCell: UITableViewCell {
    private let titleLabel = UILabel(font: Typography.font(19, .bold, relativeTo: .title3), color: Palette.ink, lines: 0)
    private let metaLabel = UILabel(font: Typography.digits(13), color: Palette.dim, lines: 0)
    private let briefBox = UIView()
    private let briefLabel = UILabel(font: Typography.font(13.5, relativeTo: .subheadline), color: Palette.inkQuiet, lines: 2)
    private let moreButton = UIButton(type: .system)
    private var onMore: (() -> Void)?

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        selectionStyle = .none
        backgroundColor = .clear
        titleLabel.accessibilityTraits = .header
        titleLabel.accessibilityIdentifier = "player.stationTitle"
        briefBox.backgroundColor = Palette.chrome
        briefBox.layer.cornerRadius = 12
        briefBox.layer.cornerCurve = .continuous
        moreButton.setTitleColor(Palette.ink, for: .normal)
        moreButton.titleLabel?.font = Typography.font(13.5, .semibold, relativeTo: .subheadline)
        moreButton.titleLabel?.adjustsFontForContentSizeCategory = true
        moreButton.contentHorizontalAlignment = .leading
        moreButton.addAction(UIAction { [weak self] _ in self?.onMore?() }, for: .primaryActionTriggered)
        moreButton.accessibilityIdentifier = "player.more"

        let brief = UIStackView(arrangedSubviews: [briefLabel, moreButton])
        brief.axis = .vertical
        brief.alignment = .leading
        brief.spacing = 0
        briefBox.addSubview(brief)
        brief.snp.makeConstraints { $0.edges.equalToSuperview().inset(UIEdgeInsets(top: 10, left: 12, bottom: 4, right: 12)) }
        moreButton.snp.makeConstraints { $0.height.greaterThanOrEqualTo(32) }

        let stack = UIStackView(arrangedSubviews: [titleLabel, metaLabel, briefBox])
        stack.axis = .vertical
        stack.spacing = 4
        stack.setCustomSpacing(12, after: metaLabel)
        contentView.addSubview(stack)
        stack.snp.makeConstraints { $0.edges.equalToSuperview().inset(UIEdgeInsets(top: 14, left: 16, bottom: 2, right: 16)) }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(model: PlayerModel, expanded: Bool, onMore: @escaping () -> Void) {
        self.onMore = onMore
        titleLabel.text = model.station?.title
        metaLabel.text = PlayerText.meta(book: model.book.manifest?.title ?? "", index: model.index, durationMs: model.durationMs)
        let brief = model.station?.brief ?? ""
        briefBox.isHidden = brief.isEmpty
        briefLabel.text = brief
        briefLabel.numberOfLines = expanded ? 0 : 2
        moreButton.setTitle(L10n.text(expanded ? "player.less" : "player.more"), for: .normal)
    }
}

private final class HeadCell: UITableViewCell {
    private let titleLabel = UILabel(font: Typography.font(16, .bold, relativeTo: .headline), color: Palette.ink)
    private let countLabel = UILabel(font: Typography.digits(13), color: Palette.dim)

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        selectionStyle = .none
        backgroundColor = .clear
        titleLabel.text = L10n.text("player.chapters")
        titleLabel.accessibilityTraits = .header
        countLabel.setContentHuggingPriority(.required, for: .horizontal)
        let row = UIStackView(arrangedSubviews: [titleLabel, UIView(), countLabel])
        row.alignment = .firstBaseline
        contentView.addSubview(row)
        row.snp.makeConstraints { $0.edges.equalToSuperview().inset(UIEdgeInsets(top: 20, left: 16, bottom: 0, right: 16)) }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(count: String) { countLabel.text = count }
}

private final class StageCell: UITableViewCell {
    private let titleLabel = UILabel(font: Typography.font(12, .semibold, relativeTo: .caption1), color: Palette.dim, lines: 0)

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        selectionStyle = .none
        titleLabel.accessibilityTraits = .header
        contentView.addSubview(titleLabel)
        titleLabel.snp.makeConstraints { $0.edges.equalToSuperview().inset(UIEdgeInsets(top: 14, left: 16, bottom: 4, right: 16)) }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(title: String, background: UIColor?) {
        backgroundColor = background
        titleLabel.attributedText = NSAttributedString(string: title, attributes: [.kern: 0.7])
    }
}

private final class StationCell: UITableViewCell {
    private let mark = StationMark()
    private let titleLabel = UILabel(font: Typography.font(16, relativeTo: .body), color: Palette.ink, lines: 0)
    private let noteLabel = UILabel(font: Typography.digits(12.5, .semibold), color: Palette.accent)
    private let minutesLabel = UILabel(font: Typography.digits(13.5), color: Palette.dim)
    private let content = UIStackView()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        let selected = UIView()
        selected.backgroundColor = Palette.chrome
        selectedBackgroundView = selected

        let text = UIStackView(arrangedSubviews: [titleLabel, noteLabel])
        text.axis = .vertical
        text.spacing = 3
        minutesLabel.setContentHuggingPriority(.required, for: .horizontal)
        minutesLabel.setContentCompressionResistancePriority(.required, for: .horizontal)
        for view in [mark, text, minutesLabel] as [UIView] { content.addArrangedSubview(view) }
        content.alignment = .top
        content.spacing = 12
        contentView.addSubview(content)
        content.snp.makeConstraints { $0.edges.equalToSuperview().inset(UIEdgeInsets(top: 10, left: 16, bottom: 10, right: 16)) }
        mark.snp.makeConstraints { $0.size.equalTo(24) }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(model: PlayerModel, index: Int, background: UIColor?) {
        backgroundColor = background
        let node = model.nodes[safe: index]
        let current = index == model.index
        let onDisk = model.isOnDisk(index)
        let done = !current && (index < model.index || model.isFinished)
        let state: StationMark.State = !onDisk ? .pending : current ? .current : done ? .done : .ahead
        mark.show(number: index + 1, state: state)

        titleLabel.text = node?.title
        titleLabel.font = Typography.font(16, current ? .semibold : .regular, relativeTo: .body)
        minutesLabel.text = L10n.minutes(ms: model.book.durationMs(at: index))
        noteLabel.text = current ? L10n.text("player.nowPlaying") : !onDisk ? L10n.text("player.downloading") : nil
        noteLabel.textColor = onDisk ? Palette.accent : Palette.dim
        noteLabel.isHidden = noteLabel.text == nil
        content.alpha = switch state {
        case .done: 0.52
        case .ahead, .pending: 0.72
        case .current: 1
        }

        accessibilityIdentifier = "player.station.\(index)"
        accessibilityLabel = [L10n.format("player.stationNo", index + 1), node?.title, minutesLabel.text, noteLabel.text]
            .compactMap { $0 }.joined(separator: ", ")
        accessibilityTraits = onDisk ? [.button] : [.button, .notEnabled]
        if current { accessibilityTraits.insert(.selected) }
    }
}

/// The numbered disc at the start of a station row.
private final class StationMark: UIView {
    enum State { case done, current, ahead, pending }

    private let ring = CAShapeLayer()
    private let label = UILabel(font: Typography.digits(12, .semibold), color: Palette.dim)
    private let check = UIImageView(image: Icons.symbol("checkmark", size: 11, weight: .bold))
    private var state = State.ahead

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.addSublayer(ring)
        label.textAlignment = .center
        label.adjustsFontForContentSizeCategory = false
        check.tintColor = Palette.done
        check.contentMode = .center
        addSubview(label)
        addSubview(check)
        label.snp.makeConstraints { $0.edges.equalToSuperview() }
        check.snp.makeConstraints { $0.edges.equalToSuperview() }
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: StationMark, _) in view.setNeedsLayout() }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(number: Int, state: State) {
        self.state = state
        label.text = "\(number)"
        label.isHidden = state == .done
        check.isHidden = state != .done
        label.textColor = state == .current ? Palette.onAccent : Palette.dim
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let inset = bounds.insetBy(dx: 0.75, dy: 0.75)
        ring.path = UIBezierPath(ovalIn: inset).cgPath
        ring.lineWidth = 1.5
        let accent = Palette.accent.resolvedColor(with: traitCollection).cgColor
        let line = Palette.line.resolvedColor(with: traitCollection).cgColor
        ring.strokeColor = state == .current ? accent : state == .pending ? Palette.dim.resolvedColor(with: traitCollection).cgColor : line
        ring.fillColor = state == .current ? accent : UIColor.clear.cgColor
        ring.lineDashPattern = state == .pending ? [3, 2.5] : nil
    }
}
