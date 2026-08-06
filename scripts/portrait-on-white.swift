// personseg.swift — cut a person out using Vision's PERSON segmenter.
//
// liftsubject.swift used VNGenerateForegroundInstanceMaskRequest, which finds
// "whatever is in front". On Simon that sliced a straight line down his cheek
// and took the ear with it: that side of his face sits against pale marble, so
// the generic saliency model lost the boundary and guessed.
//
// VNGeneratePersonSegmentationRequest is trained on people specifically, so it
// holds face and hair edges far better. It returns a soft matte rather than a
// hard instance mask, which also gives cleaner hair.
//
//   swift scripts/portrait-on-white.swift <in.jpg> <out.png> <hex-bg|none>
//
// This produced assets/founders/{emil,simon}-white.jpg from the .jpg originals
// beside them, which are kept as the source. Then frame it with scripts/frame-portrait.mjs, which crops to 4:5 (the
// .founder-portrait frame is 220x280 with object-fit: cover, so a square would
// be cropped a second time by the browser) and writes JPEG, not PNG — the
// background is opaque, and PNG cost 362KB for the pair where JPEG costs 51KB.

import Foundation
import Vision
import CoreImage
import AppKit

let args = CommandLine.arguments
guard args.count >= 4 else {
    FileHandle.standardError.write("usage: personseg <in> <out.png> <hex|none>\n".data(using: .utf8)!)
    exit(2)
}
let inPath = args[1], outPath = args[2], bgArg = args[3].uppercased()

guard let src = CIImage(contentsOf: URL(fileURLWithPath: inPath)) else { exit(1) }

let request = VNGeneratePersonSegmentationRequest()
request.qualityLevel = .accurate           // slower; this runs twice, not in a loop
request.outputPixelFormat = kCVPixelFormatType_OneComponent8

let handler = VNImageRequestHandler(ciImage: src, options: [:])
do { try handler.perform([request]) } catch {
    FileHandle.standardError.write("vision failed: \(error)\n".data(using: .utf8)!); exit(1)
}
guard let buf = request.results?.first?.pixelBuffer else {
    FileHandle.standardError.write("no person found\n".data(using: .utf8)!); exit(1)
}

// The matte comes back at the model's own resolution, not the photo's.
var mask = CIImage(cvPixelBuffer: buf)
mask = mask.transformed(by: CGAffineTransform(
    scaleX: src.extent.width / mask.extent.width,
    y: src.extent.height / mask.extent.height))

let bg: CIImage
if bgArg == "NONE" {
    bg = CIImage(color: .clear).cropped(to: src.extent)
} else {
    let hex = bgArg.hasPrefix("#") ? String(bgArg.dropFirst()) : bgArg
    guard hex.count == 6, let v = Int(hex, radix: 16) else { exit(2) }
    bg = CIImage(color: CIColor(red: CGFloat((v >> 16) & 0xFF) / 255,
                                green: CGFloat((v >> 8) & 0xFF) / 255,
                                blue: CGFloat(v & 0xFF) / 255)).cropped(to: src.extent)
}

let blend = CIFilter(name: "CIBlendWithMask")!
blend.setValue(src, forKey: kCIInputImageKey)
blend.setValue(bg, forKey: kCIInputBackgroundImageKey)
blend.setValue(mask, forKey: kCIInputMaskImageKey)
guard let out = blend.outputImage else { exit(1) }

let ctx = CIContext()
guard let cg = ctx.createCGImage(out, from: src.extent),
      let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: URL(fileURLWithPath: outPath))
print("\(URL(fileURLWithPath: inPath).lastPathComponent) -> \(outPath) (person segmentation, accurate)")
