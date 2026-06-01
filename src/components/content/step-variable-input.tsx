"use client";

interface Props {
  variables: string[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

export function StepVariableInput({ variables, values, onChange }: Props) {
  if (variables.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-1">Biến đầu vào</h2>
        <p className="text-sm text-gray-500 py-6 text-center">
          Template này không có biến. Nhấn &quot;Generate&quot; để tiếp tục.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Điền biến đầu vào</h2>
      <p className="text-sm text-gray-500 mb-4">
        Điền nội dung cho {variables.length} biến trong template
      </p>
      <div className="space-y-4">
        {variables.map((v) => (
          <div key={v}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <code className="bg-amber-50 text-amber-700 px-1 py-0.5 rounded text-xs">
                {`{{${v}}}`}
              </code>
            </label>
            <textarea
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={`Nhập giá trị cho ${v}...`}
              value={values[v] ?? ""}
              onChange={(e) => onChange(v, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
