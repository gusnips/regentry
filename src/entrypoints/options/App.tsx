import { ProviderForm, ProviderList } from "@/modules/providers/ui";

export default function App() {
  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
        <img src="/icon.svg" className="h-6 w-6" alt="" />
        Regent settings
      </h1>

      <ProviderList />

      <section className="mt-6">
        <h2 className="text-sm font-medium text-neutral-700">Add provider</h2>
        <div className="mt-3">
          <ProviderForm />
        </div>
      </section>
    </div>
  );
}
