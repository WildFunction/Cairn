/// The packages the app is built with, and the terms they ask to travel with them.
enum Acknowledgements {
    struct Package {
        let name: String
        let url: String
        let notice: String
    }

    static let packages = [
        Package(name: "SnapKit", url: "https://github.com/SnapKit/SnapKit", notice: mit("Copyright (c) 2011-Present SnapKit Team - https://github.com/SnapKit")),
        Package(name: "SwiftAudioEx", url: "https://github.com/doublesymmetry/SwiftAudioEx", notice: mit("Copyright (c) 2021 Double Symmetry")),
        Package(name: "LookinServer", url: "https://github.com/QMUI/LookinServer", notice: mit("Copyright (c) 2023 LI KAI")),
    ]

    private static func mit(_ copyright: String) -> String {
        """
        \(copyright)

        Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

        The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
        """
    }
}
