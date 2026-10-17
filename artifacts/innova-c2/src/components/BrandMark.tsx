export function BrandMark({ className = "" }: { className?: string }) {
  return <img
    className={`brand-mark ${className}`}
    src={`${import.meta.env.BASE_URL}branding/innova-c2-logo.png`}
    alt="Logo de INNOVA-C2"
    width={42}
    height={42}
    decoding="async"
  />;
}
