import { ProviderForm, ProviderList } from "@/modules/providers/ui";

export default function App() {
  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="text-lg font-semibold text-neutral-900">Regent settings</h1>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-neutral-700">Providers</h2>
        <div className="mt-3">
          <ProviderList />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-neutral-700">Add provider</h2>
        <div className="mt-3">
          <ProviderForm />
        </div>
      </section>
    </div>
  );
}
