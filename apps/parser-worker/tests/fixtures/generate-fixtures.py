from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FIXTURE_DIRECTORY = Path(__file__).parent
TEXT = "PAYMENT 30 DAYS"


def create_png(path: Path) -> None:
    image = Image.new("RGB", (1200, 300), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 88)
    bounds = draw.textbbox((0, 0), TEXT, font=font)
    x = (image.width - (bounds[2] - bounds[0])) // 2
    y = (image.height - (bounds[3] - bounds[1])) // 2 - bounds[1]
    draw.text((x, y), TEXT, fill="black", font=font)
    image.save(path, format="PNG")


def create_pdf(path: Path) -> None:
    stream = f"BT\n/F1 18 Tf\n72 720 Td\n({TEXT}) Tj\nET\n"
    page = (
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
    )
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        page,
        f"<< /Length {len(stream.encode('ascii'))} >>\nstream\n{stream}endstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    output = "%PDF-1.4\n"
    offsets = [0]
    for index, object_value in enumerate(objects, start=1):
        offsets.append(len(output.encode("ascii")))
        output += f"{index} 0 obj\n{object_value}\nendobj\n"
    xref_offset = len(output.encode("ascii"))
    output += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"
    output += "".join(f"{offset:010d} 00000 n \n" for offset in offsets[1:])
    output += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n"
    )
    path.write_bytes(output.encode("ascii"))


FIXTURE_DIRECTORY.mkdir(exist_ok=True)
create_pdf(FIXTURE_DIRECTORY / "parser-sample.pdf")
create_png(FIXTURE_DIRECTORY / "parser-sample.png")
