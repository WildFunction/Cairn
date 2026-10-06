import CairnKit
import SnapKit
import UIKit

/// A plain grouped table: language, iCloud, autoplay, storage, version, acknowledgements.
/// Appearance follows the system, so it is not offered here.
final class SettingsViewController: UITableViewController {
    private enum Row {
        case language, account, syncNow, autoplay, storage, version, acknowledgements
    }

    private let sections: [(header: String?, footer: String?, rows: [Row])] = [
        (L10n.text("settings.general"), nil, [.language]),
        (L10n.text("settings.icloud"), L10n.text("settings.icloud.footer"), [.account, .syncNow]),
        (L10n.text("settings.playback"), nil, [.autoplay]),
        (L10n.text("settings.storage"), L10n.text("settings.storage.footer"), [.storage]),
        (L10n.text("settings.about"), nil, [.version, .acknowledgements]),
    ]

    private let environment: AppEnvironment
    private var account: CloudAccount?
    private var syncing = false

    init(environment: AppEnvironment) {
        self.environment = environment
        super.init(style: .insetGrouped)
        title = L10n.text("shelf.settings")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.backgroundColor = Palette.page
        tableView.accessibilityIdentifier = "settings.table"
        // The system's own Done would be in the system's language, not the one chosen here.
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: L10n.text("settings.done"), primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) })
        navigationItem.rightBarButtonItem?.style = .done
        navigationItem.rightBarButtonItem?.accessibilityIdentifier = "settings.done"
        navigationItem.backButtonTitle = L10n.text("shelf.settings")
        Task {
            account = await environment.cloud.account()
            tableView.reloadData()
        }
    }

    override func numberOfSections(in tableView: UITableView) -> Int { sections.count }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        sections[section].rows.count
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        sections[section].header
    }

    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        sections[section].footer
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .value1, reuseIdentifier: nil)
        var content = UIListContentConfiguration.valueCell()
        cell.backgroundColor = Palette.card
        cell.selectionStyle = .none
        switch sections[indexPath.section].rows[indexPath.row] {
        case .language:
            content.text = L10n.text("settings.language")
            content.secondaryText = AppLanguage.chosen.name
            cell.accessoryType = .disclosureIndicator
            cell.selectionStyle = .default
            cell.accessibilityIdentifier = "settings.language"
        case .account:
            content.text = L10n.text("settings.icloud.account")
            content.secondaryText = account.map(L10n.account) ?? "…"
            cell.accessibilityIdentifier = "settings.account"
        case .syncNow:
            content = .cell()
            content.text = L10n.text(syncing ? "settings.syncing" : "settings.syncNow")
            content.textProperties.color = environment.isCloudEnabled && !syncing ? Palette.accent : Palette.dim
            cell.selectionStyle = .default
            cell.accessibilityTraits = .button
            cell.accessibilityIdentifier = "settings.syncNow"
        case .autoplay:
            content = .cell()
            content.text = L10n.text("settings.autoplay")
            let toggle = UISwitch()
            toggle.isOn = environment.preferences.player.autoplay
            toggle.onTintColor = Palette.accent
            toggle.accessibilityIdentifier = "settings.autoplay"
            toggle.addAction(UIAction { [weak self] action in
                guard let toggle = action.sender as? UISwitch else { return }
                self?.environment.preferences.player.autoplay = toggle.isOn
            }, for: .valueChanged)
            cell.accessoryView = toggle
        case .storage:
            content.text = L10n.text("settings.storage.used")
            content.secondaryText = L10n.bytes(environment.library.bytesUsed())
        case .version:
            content.text = L10n.text("settings.version")
            let info = Bundle.main.infoDictionary
            let version = info?["CFBundleShortVersionString"] as? String ?? "?"
            let build = info?["CFBundleVersion"] as? String ?? "?"
            content.secondaryText = "\(version) (\(build))"
        case .acknowledgements:
            content = .cell()
            content.text = L10n.text("settings.acknowledgements")
            cell.accessoryType = .disclosureIndicator
            cell.selectionStyle = .default
            cell.accessibilityIdentifier = "settings.acknowledgements"
        }
        cell.contentConfiguration = content
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        switch sections[indexPath.section].rows[indexPath.row] {
        case .syncNow: syncNow()
        case .language: navigationController?.pushViewController(LanguageViewController(), animated: true)
        case .acknowledgements: navigationController?.pushViewController(AcknowledgementsViewController(), animated: true)
        default: break
        }
    }

    private func syncNow() {
        guard environment.isCloudEnabled, !syncing else { return }
        syncing = true
        tableView.reloadData()
        Task {
            await environment.refreshFromCloud()
            account = await environment.cloud.account()
            syncing = false
            tableView.reloadData()
        }
    }
}

/// Follow the system, or one of the two languages the app is written in. Chosen, it takes effect at once.
final class LanguageViewController: UITableViewController {
    init() {
        super.init(style: .insetGrouped)
        title = L10n.text("settings.language")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        tableView.backgroundColor = Palette.page
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        AppLanguage.allCases.count
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let language = AppLanguage.allCases[indexPath.row]
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        var content = cell.defaultContentConfiguration()
        content.text = language.name
        cell.contentConfiguration = content
        cell.backgroundColor = Palette.card
        cell.tintColor = Palette.accent
        cell.accessoryType = language == AppLanguage.chosen ? .checkmark : .none
        cell.accessibilityIdentifier = "language.\(language.rawValue)"
        if language == AppLanguage.chosen { cell.accessibilityTraits.insert(.selected) }
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        let language = AppLanguage.allCases[indexPath.row]
        guard language != AppLanguage.chosen else {
            navigationController?.popViewController(animated: true)
            return
        }
        AppLanguage.chosen = language
        (view.window?.windowScene?.delegate as? SceneDelegate)?.languageDidChange()
    }
}

final class AcknowledgementsViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        title = L10n.text("settings.acknowledgements")
        view.backgroundColor = Palette.page
        let text = UITextView()
        text.isEditable = false
        text.backgroundColor = .clear
        text.adjustsFontForContentSizeCategory = true
        text.textContainerInset = UIEdgeInsets(top: 16, left: 12, bottom: 32, right: 12)
        text.attributedText = Self.body()
        text.accessibilityIdentifier = "acknowledgements.text"
        view.addSubview(text)
        text.snp.makeConstraints { $0.edges.equalToSuperview() }
    }

    private static func body() -> NSAttributedString {
        let result = NSMutableAttributedString()
        for package in Acknowledgements.packages {
            result.append(NSAttributedString(string: "\(package.name)\n", attributes: [
                .font: Typography.font(17, .semibold, relativeTo: .headline), .foregroundColor: Palette.ink,
            ]))
            result.append(NSAttributedString(string: "\(package.url)\n\n", attributes: [
                .font: Typography.font(13, relativeTo: .footnote), .foregroundColor: Palette.accent,
            ]))
            result.append(NSAttributedString(string: "\(package.notice)\n\n\n", attributes: [
                .font: Typography.font(13, relativeTo: .footnote), .foregroundColor: Palette.inkQuiet,
            ]))
        }
        return result
    }
}
