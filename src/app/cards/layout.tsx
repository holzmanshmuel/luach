import './cards.css';

export default function CardsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="cards-root">{children}</div>;
}
