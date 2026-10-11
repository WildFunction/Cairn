// The text of a scanned PDF, read by the Vision framework that ships with macOS.
// A PDF on stdin; one JSON line per page on stdout, each the runs of text Vision
// found with their position in PDF units from the page's bottom-left corner.
// `packages/core/src/runtime/vision-ocr.ts` is the other end of the pipe.
import Foundation
import PDFKit
import Vision

/// The page's long edge in pixels: about 240 dpi for a trade paperback, where Vision's accuracy levels off.
let longEdge: CGFloat = 2200
let languages = ["zh-Hans", "zh-Hant", "en-US"]

struct Run: Encodable {
    let text: String
    let x: Double
    let y: Double
    let height: Double
}

struct Page: Encodable {
    let runs: [Run]
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func recognise(_ image: CGImage, size: CGSize) throws -> [Run] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = languages
    request.automaticallyDetectsLanguage = true
    try VNImageRequestHandler(cgImage: image).perform([request])

    return (request.results ?? []).compactMap { observation in
        guard let text = observation.topCandidates(1).first?.string, !text.isEmpty else { return nil }
        let box = observation.boundingBox
        return Run(
            text: text,
            x: Double(box.minX * size.width),
            y: Double(box.minY * size.height),
            height: Double(box.height * size.height)
        )
    }
}

guard let document = PDFDocument(data: FileHandle.standardInput.readDataToEndOfFile()) else {
    fail("not a PDF")
}
if document.isLocked { fail("locked") }

let lock = NSLock()
let group = DispatchGroup()
let slots = DispatchSemaphore(value: ProcessInfo.processInfo.activeProcessorCount)
let workers = DispatchQueue(label: "ocr", attributes: .concurrent)
var pages = [[Run]](repeating: [], count: document.pageCount)
var failure: String?

for index in 0..<document.pageCount {
    guard let page = document.page(at: index) else { continue }
    // `thumbnail` applies the page's rotation, so the size it reports is the one the runs are measured in.
    let bounds = page.bounds(for: .mediaBox)
    let turned = page.rotation % 180 != 0
    let size = turned ? CGSize(width: bounds.height, height: bounds.width) : bounds.size
    let scale = longEdge / max(size.width, size.height, 1)
    let pixels = CGSize(width: size.width * scale, height: size.height * scale)
    guard let image = page.thumbnail(of: pixels, for: .mediaBox).cgImage(forProposedRect: nil, context: nil, hints: nil)
    else { continue }

    // PDFKit renders on this thread only; the slots keep rendered pages from piling up ahead of Vision.
    slots.wait()
    workers.async(group: group) {
        defer { slots.signal() }
        do {
            let runs = try recognise(image, size: size)
            lock.withLock { pages[index] = runs }
        } catch {
            lock.withLock { failure = error.localizedDescription }
        }
    }
}
group.wait()
if let failure { fail(failure) }

let encoder = JSONEncoder()
var output = Data()
for runs in pages {
    guard let line = try? encoder.encode(Page(runs: runs)) else { fail("unencodable page") }
    output.append(line)
    output.append(0x0A)
}
FileHandle.standardOutput.write(output)
