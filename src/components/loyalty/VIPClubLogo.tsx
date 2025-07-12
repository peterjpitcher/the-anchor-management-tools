import Image from 'next/image';

interface VIPClubLogoProps {
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

export default function VIPClubLogo({ size = 'medium', className = '' }: VIPClubLogoProps) {
  const sizes = {
    small: { width: 120, height: 150 },
    medium: { width: 180, height: 225 },
    large: { width: 240, height: 300 }
  };

  const { width, height } = sizes[size];

  return (
    <div className={`inline-block ${className}`}>
      <Image
        src="/VIPs.png"
        alt="The Anchor VIP Club"
        width={width}
        height={height}
        className="drop-shadow-xl"
        priority
      />
    </div>
  );
}