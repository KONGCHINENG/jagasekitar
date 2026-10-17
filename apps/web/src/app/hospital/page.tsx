export default function HospitalHome() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Hospital portal</h1>
      <p
        role="note"
        className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
      >
        Enter aggregated counts only. Do not enter patient names, IC numbers, or any personal data.
      </p>
      <p className="mt-6 text-neutral-600 dark:text-neutral-400">
        Sign-in, the daily case entry form, CSV upload and history arrive in Phase 7.
      </p>
    </main>
  );
}
