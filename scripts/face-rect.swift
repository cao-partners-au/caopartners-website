// facerect.swift — print the face bounding box, in pixels, top-left origin.
//
// Framing by SUBJECT WIDTH breaks across poses: Simon's warehouse photo has his
// elbows spread far wider than Emil's, so matching shoulder widths made his head
// noticeably smaller. The eye compares faces, not silhouettes, so the face is
// what the crop should be normalised on.
import Foundation
import Vision
import CoreImage

let p = CommandLine.arguments[1]
guard let img = CIImage(contentsOf: URL(fileURLWithPath: p)) else { exit(1) }
let req = VNDetectFaceRectanglesRequest()
try VNImageRequestHandler(ciImage: img, options: [:]).perform([req])
guard let f = (req.results?.max(by: { $0.boundingBox.height < $1.boundingBox.height })) else {
    FileHandle.standardError.write("no face\n".data(using: .utf8)!); exit(1)
}
let W = img.extent.width, H = img.extent.height
let b = f.boundingBox              // normalised, bottom-left origin
print("\(Int(b.minX * W)) \(Int((1 - b.maxY) * H)) \(Int(b.width * W)) \(Int(b.height * H))")
