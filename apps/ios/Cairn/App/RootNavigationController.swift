import UIKit

/// Lets the screen on top answer for itself: the shelf stays upright, the player turns.
final class RootNavigationController: UINavigationController {
    override func viewDidLoad() {
        super.viewDidLoad()
        setNavigationBarHidden(true, animated: false)
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        topViewController?.supportedInterfaceOrientations ?? .portrait
    }

    override var childForStatusBarHidden: UIViewController? { topViewController }
    override var childForStatusBarStyle: UIViewController? { topViewController }
    override var childForHomeIndicatorAutoHidden: UIViewController? { topViewController }
}
