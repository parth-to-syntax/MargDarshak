export function MargDarshakBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        className="absolute inset-0 opacity-20 blur-[0.2px]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(79,70,229,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(79,70,229,0.16) 1px, transparent 1px)',
          backgroundSize: '46px 46px',
        }}
      />
      <div className="absolute left-[10%] top-[22%] h-64 w-64 rounded-full bg-blue-300/25 blur-3xl" />
      <div className="absolute right-[8%] top-[16%] h-72 w-72 rounded-full bg-indigo-300/20 blur-3xl" />
      <div className="absolute bottom-[-8%] left-[34%] h-80 w-80 rounded-full bg-sky-300/20 blur-3xl" />
    </div>
  )
}
