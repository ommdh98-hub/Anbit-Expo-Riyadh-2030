import Image from "next/image";

// This small, lossless PNG is the exact approved file. No recolouring or cropping.
export default function BrandLogo({
  variant = "sidebar",
  eager = false,
}: {
  variant?: "login" | "sidebar" | "navigation" | "report";
  eager?: boolean;
}) {
  return (
    <Image
      src="/brand/anbit-official.png"
      alt="ANBIT"
      width={356}
      height={168}
      className={`anbit-official-logo logo-${variant}`}
      unoptimized
      loading={eager ? "eager" : "lazy"}
    />
  );
}
