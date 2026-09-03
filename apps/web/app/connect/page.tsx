import { ConnectForm } from "@/components/connect-form";

export default function ConnectPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Waiver-Wire</h1>
        <p className="mt-1 text-sm text-muted">
          Weekly start/sit and waiver decisions for your Sleeper league. Every number is a range.
        </p>
      </header>
      <ConnectForm />
    </main>
  );
}
