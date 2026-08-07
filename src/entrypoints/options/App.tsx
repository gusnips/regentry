import { AddProviderDialog, ProviderList } from "@/modules/providers/ui";
import { Button } from "@/components/Button";

export default function App() {
  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
        <img src="/icon.svg" className="h-6 w-6" alt="" />
        Regent settings
      </h1>

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">Providers</h2>
          <AddProviderDialog trigger={<Button size="sm">Add provider</Button>} />
        </div>
        <div className="mt-3">
          <ProviderList />
        </div>
      </section>
    </div>
  );
}
