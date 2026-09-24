import {
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  TimerReset,
  Unplug,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";

export type JevConnectionDialogPreviewState =
  | "default"
  | "hover"
  | "focus"
  | "active"
  | "disabled"
  | "loading"
  | "error"
  | "success";

export interface JevConnectionView {
  source: "session";
  expiresAt?: string;
  remainingCalls?: number;
}

export interface JevConnectionDialogProps {
  open: boolean;
  connection: JevConnectionView | null;
  serverConfigured: boolean;
  loading: boolean;
  error: string | null;
  /** A Pages-hosted interface preview that intentionally has no API runtime. */
  staticPreview?: boolean;
  onClose: () => void;
  onConnect: (apiKey: string) => Promise<void> | void;
  onDisconnect: () => Promise<void> | void;
  previewState?: JevConnectionDialogPreviewState;
  preview?: boolean;
}

function formatExpiry(value?: string): string {
  if (!value) return "本次会话结束前";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "本次会话结束前";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(time);
}

/**
 * A write-only BYOK field. The API key lives only in the uncontrolled input
 * long enough to create an opaque encrypted server session, then the DOM value is erased.
 */
export function JevConnectionDialog({
  open,
  connection,
  serverConfigured,
  loading,
  error,
  staticPreview = false,
  onClose,
  onConnect,
  onDisconnect,
  previewState = "default",
  preview = false,
}: JevConnectionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const helperId = useId();
  const [validationError, setValidationError] = useState<string | null>(null);

  const isPreviewLoading = previewState === "loading";
  const isPreviewError = previewState === "error";
  const isPreviewDisabled = previewState === "disabled";
  const isPreviewSuccess = previewState === "success";
  const isLoading = loading || isPreviewLoading;
  const isDisabled = isPreviewDisabled;
  const displayedError = isPreviewError
    ? "密钥未通过验证。请确认后重新粘贴。"
    : validationError ?? error;
  const isConnected = Boolean(connection) || isPreviewSuccess;

  useEffect(() => {
    if (preview) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => {
        if (connection) {
          dialog.querySelector<HTMLButtonElement>(".jev-connection-dialog__disconnect")?.focus();
          return;
        }
        if (staticPreview) {
          dialog.querySelector<HTMLButtonElement>(".jev-connection-dialog__close")?.focus();
          return;
        }
        inputRef.current?.focus();
      });
    }
    if (!open && dialog.open) dialog.close();
  }, [connection, open, preview, staticPreview]);

  useEffect(() => {
    if (!open) {
      setValidationError(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [open]);

  function clearInput() {
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLoading || isDisabled) return;
    const value = inputRef.current?.value.trim() ?? "";
    clearInput();
    if (!value) {
      setValidationError("未收到 API Key。请粘贴完整密钥后重试。");
      inputRef.current?.focus();
      return;
    }
    setValidationError(null);
    void onConnect(value);
  }

  function handleInput() {
    if (validationError) setValidationError(null);
  }

  function handleDisconnect() {
    if (isLoading || isDisabled) return;
    void onDisconnect();
  }

  const header = (
    <header className="jev-connection-dialog__header">
      <div>
        <span className="jev-connection-dialog__mark" aria-hidden="true">
          {isConnected ? <CheckCircle2 size={18} /> : <KeyRound size={18} />}
        </span>
        <div>
          <h2 id={titleId}>{staticPreview ? "Jev API 未部署" : "连接 Jev"}</h2>
          <p id={descriptionId}>{staticPreview ? "该站点为 GitHub Pages 静态演示版，不能运行应用 API。" : "密钥仅用于本次临时会话；不会写入浏览器存储、运行报文或界面日志。"}</p>
        </div>
      </div>
      <button
        type="button"
        className="jev-connection-dialog__close"
        aria-label="关闭 Jev 连接"
        disabled={isLoading || isDisabled}
        onClick={onClose}
      >
        <X size={18} />
      </button>
    </header>
  );

  const connectedBody = (
    <div className="jev-connection-dialog__connected" data-state={isPreviewSuccess ? "success" : "default"}>
      <div className="jev-connection-dialog__status-mark" aria-hidden="true"><CheckCircle2 size={22} /></div>
      <div>
        <strong>Jev 已临时连接</strong>
        <p>服务端仅以加密短时凭证处理本次连接，到 {formatExpiry(connection?.expiresAt)} 自动失效。</p>
      </div>
      <dl aria-label="本次 Jev 会话状态">
        <div><dt>会话</dt><dd>临时</dd></div>
        <div><dt>到期</dt><dd>{formatExpiry(connection?.expiresAt)}</dd></div>
        <div><dt>可用调用</dt><dd>{connection?.remainingCalls ?? "—"}</dd></div>
      </dl>
      <button
        type="button"
        className="jev-connection-dialog__disconnect"
        disabled={isLoading || isDisabled}
        data-state={isLoading ? "loading" : "default"}
        onClick={handleDisconnect}
      >
        {isLoading ? <LoaderCircle size={17} className="spinner" aria-hidden="true" /> : <Unplug size={17} />}
        <span>{isLoading ? "正在清除" : "移除此设备的会话凭证"}</span>
      </button>
    </div>
  );

  const formBody = (
    <form className="jev-connection-dialog__form" onSubmit={handleSubmit} noValidate>
      <div className="jev-connection-dialog__security-note">
        <LockKeyhole size={17} aria-hidden="true" />
        <span>仅经 HTTPS 传给服务端验证；验证后浏览器不再持有原始 Key。</span>
      </div>
      {serverConfigured && (
        <p className="jev-connection-dialog__managed"><ShieldCheck size={16} />此环境也有受管 Jev Key；输入新 Key 只替换本次浏览器会话。</p>
      )}
      <label className="jev-connection-dialog__field" data-state={displayedError ? "error" : isLoading ? "loading" : "default"}>
        <span>Jev API Key</span>
        <span className="jev-connection-dialog__input-wrap">
          <input
            ref={inputRef}
            type="password"
            name="jev-api-key"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="粘贴临时使用的 Key"
            aria-required="true"
            aria-invalid={Boolean(displayedError)}
            aria-describedby={helperId}
            disabled={isDisabled || isLoading}
            onInput={handleInput}
          />
          <span className="jev-connection-dialog__input-icon" aria-hidden="true">
            {isLoading ? <LoaderCircle size={17} className="spinner" /> : displayedError ? <X size={17} /> : <KeyRound size={17} />}
          </span>
        </span>
      </label>
      <p id={helperId} className="jev-connection-dialog__helper" data-tone={displayedError ? "error" : "default"} role={displayedError ? "alert" : undefined}>
        {displayedError ?? "粘贴后将立即清空输入框；关闭连接会清除本机凭证，闲置或到期后服务端拒绝该临时连接。"}
      </p>
      <footer className="jev-connection-dialog__actions">
        <span><TimerReset size={16} aria-hidden="true" />最长保留 15 分钟</span>
        <button type="submit" data-state={isLoading ? "loading" : "default"} disabled={isLoading || isDisabled}>
          {isLoading ? <LoaderCircle size={17} className="spinner" aria-hidden="true" /> : <ShieldCheck size={17} />}
          <span>{isLoading ? "正在验证" : "验证并刷新"}</span>
        </button>
      </footer>
    </form>
  );

  const staticBody = (
    <section className="jev-connection-dialog__form" aria-label="静态演示版说明">
      <div className="jev-connection-dialog__security-note">
        <LockKeyhole size={17} aria-hidden="true" />
        <span>为避免把 Key 发送到错误位置，此版本没有输入框，也不会接收、保存或传输 Jev API Key。</span>
      </div>
      <p className="jev-connection-dialog__helper">真实逐时决策需要将本项目的 API 服务部署到具备 Node 运行时的受信任平台，并把密钥仅写入该平台的环境变量。</p>
      <footer className="jev-connection-dialog__actions">
        <span><ShieldCheck size={16} aria-hidden="true" />未连接 Jev</span>
        <button type="button" onClick={onClose}><span>知道了</span></button>
      </footer>
    </section>
  );

  const content = (
    <div className="jev-connection-dialog__surface">
      {header}
      {staticPreview ? staticBody : isConnected ? connectedBody : formBody}
    </div>
  );

  if (preview) {
    return (
      <section
        className="jev-connection-dialog jev-connection-dialog--preview"
        data-preview-state={previewState}
        aria-labelledby={titleId}
        aria-busy={isLoading}
      >
        {content}
      </section>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="jev-connection-dialog"
      data-preview-state={previewState}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={isLoading}
      onCancel={(event) => {
        event.preventDefault();
        if (!isLoading && !isDisabled) onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isLoading && !isDisabled) onClose();
      }}
    >
      {content}
    </dialog>
  );
}
