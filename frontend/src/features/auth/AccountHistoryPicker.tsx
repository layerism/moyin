import type { RememberedLoginAccount } from "./rememberedAccount";

export function AccountHistoryPicker({
  accounts,
  identifierLabel,
  onForget,
  onSelect,
}: {
  accounts: RememberedLoginAccount[];
  identifierLabel: "工号" | "学号";
  onForget: (identifier: string) => void;
  onSelect: (account: RememberedLoginAccount) => void;
}) {
  return (
    <div aria-label="历史账号" className="account-history-picker" role="list">
      {accounts.map((account) => (
        <div className="account-history-option" key={account.identifier} role="listitem">
          <button
            aria-label={`${account.name}，${identifierLabel} ${account.identifier}`}
            className="account-history-select"
            onClick={() => onSelect(account)}
            type="button"
          >
            <strong>{account.name}</strong>
            <small>{identifierLabel}：{account.identifier}</small>
          </button>
          <button
            aria-label={`删除历史账号 ${account.name}`}
            className="account-history-forget"
            onClick={() => onForget(account.identifier)}
            title="删除历史记录"
            type="button"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
