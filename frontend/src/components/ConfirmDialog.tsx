import { useRef, useEffect } from "react";

export function ConfirmDialog(props: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { message, onConfirm, onCancel } = props;
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog ref={ref} className="modal confirm-dialog" onClose={onCancel}>
      <p>{message}</p>
      <footer>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="danger" onClick={onConfirm}>Delete</button>
      </footer>
    </dialog>
  );
}
