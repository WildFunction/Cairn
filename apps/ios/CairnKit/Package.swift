// swift-tools-version: 6.0
import PackageDescription

// Everything about a book and how it plays that needs no screen: `swift test` runs it on the Mac.
let package = Package(
    name: "CairnKit",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [.library(name: "CairnKit", targets: ["CairnKit"])],
    targets: [
        .target(name: "CairnKit"),
        .testTarget(name: "CairnKitTests", dependencies: ["CairnKit"]),
    ]
)
