import CairnKit
import SnapKit
import UIKit

/// `Off`, four lengths and `End of chapter`, from the bottom of the screen.
final class SleepSheetController: UITableViewController {
    private let model: PlayerModel

    init(model: PlayerModel) {
        self.model = model
        super.init(style: .insetGrouped)
        title = L10n.text("sleep.title")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.backgroundColor = Palette.card
        tableView.accessibilityIdentifier = "sleep.sheet"
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        SleepTimer.choices.count
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .value1, reuseIdentifier: nil)
        let mode = SleepTimer.choices[indexPath.row]
        let selected = mode == model.sleep.mode
        var content = cell.defaultContentConfiguration()
        content.text = PlayerText.sleepChoice(mode)
        content.textProperties.color = selected ? Palette.accent : Palette.ink
        content.textProperties.font = Typography.font(17, selected ? .semibold : .regular)
        if mode == .endOfChapter {
            content.secondaryText = L10n.format("sleep.left", L10n.clock(ms: Int(Double(max(0, model.durationMs - model.positionMs)) / model.effectiveRate)))
            content.secondaryTextProperties.font = Typography.digits(14)
            content.secondaryTextProperties.color = Palette.dim
        }
        content.prefersSideBySideTextAndSecondaryText = true
        cell.contentConfiguration = content
        cell.backgroundColor = Palette.page
        cell.accessoryType = selected ? .checkmark : .none
        cell.tintColor = Palette.accent
        cell.accessibilityIdentifier = "sleep.choice.\(indexPath.row)"
        if selected { cell.accessibilityTraits.insert(.selected) }
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        model.setSleep(SleepTimer.choices[indexPath.row])
        dismiss(animated: true)
    }
}

/// The chapter list as a sheet, for full screen, where the list under the slide cannot be seen.
final class ChaptersSheetController: UIViewController {
    private let model: PlayerModel
    private let list = ChapterListView(showsInfo: false)

    init(model: PlayerModel) {
        self.model = model
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Palette.card
        let title = UILabel(font: Typography.font(17, .semibold, relativeTo: .headline), color: Palette.ink)
        title.text = L10n.text("player.chapters")
        title.accessibilityTraits = .header
        view.addSubview(title)
        view.addSubview(list)
        title.snp.makeConstraints { make in
            make.top.equalTo(view.safeAreaLayoutGuide).inset(16)
            make.centerX.equalToSuperview()
        }
        list.snp.makeConstraints { make in
            make.top.equalTo(title.snp.bottom).offset(8)
            make.leading.trailing.bottom.equalTo(view.safeAreaLayoutGuide)
        }
        list.onSelect = { [weak self] index in
            self?.model.select(index)
            self?.dismiss(animated: true)
        }
        list.show(model)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        list.scrollToCurrent(animated: false)
    }
}
