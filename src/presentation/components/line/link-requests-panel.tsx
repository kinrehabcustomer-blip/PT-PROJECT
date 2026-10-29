"use client";

import type { LinkTarget } from "@/domain/models";
import { useApp } from "@/presentation/state/app-context";

const TARGET_LABEL: Record<LinkTarget, string> = { patient: "ผู้ป่วย", relative: "ญาติ", therapist: "นักกายภาพ" };

/** People who typed a name to the clinic's LINE account, waiting for staff to confirm it is really them. */
export function LinkRequestsPanel() {
  const { data, role, act } = useApp();
  if (!data || role === "therapist" || data.linkRequests.length === 0) return null;

  const nameOf = (target: LinkTarget, id: string) =>
    target === "therapist" ? data.therapists.find((t) => t.id === id)?.name : data.patients.find((p) => p.id === id)?.name;
  const existing = (target: LinkTarget, id: string) =>
    target === "therapist"
      ? data.therapists.find((t) => t.id === id)?.lineUserId
      : target === "relative"
        ? data.patients.find((p) => p.id === id)?.relativeLineUserId
        : data.patients.find((p) => p.id === id)?.lineUserId;

  return (
    <section className="panel stack-pad request-panel" aria-label="คำขอผูก LINE ที่รอยืนยัน">
      <div className="panel-title">คำขอผูก LINE รอยืนยัน ({data.linkRequests.length})</div>
      <p className="ack-note">
        มีคนพิมพ์ชื่อมาที่ LINE ของคลินิก ตรวจว่า<strong>ชื่อ LINE ตรงกับตัวบุคคล</strong>ก่อนกดอนุมัติ (ถ้าไม่แน่ใจให้โทรยืนยันเบอร์เดิม)
        เพราะคนที่รู้ชื่ออาจสวมรอยเพื่อรับข้อมูลนัดหมายและที่อยู่ได้
      </p>
      {data.linkRequests.map((r) => (
        <div className="history-line" key={r.id}>
          <span>
            <strong>{TARGET_LABEL[r.target]}</strong> · {nameOf(r.target, r.targetId) ?? "(ไม่พบรายชื่อ)"} ← ชื่อ LINE: <strong>{r.displayName ?? "ไม่ทราบ"}</strong>
            {" "}· {new Date(r.requestedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" })}
            {existing(r.target, r.targetId) && <em className="warn"> · จะแทนที่บัญชี LINE เดิมที่ผูกอยู่</em>}
          </span>
          <span className="appointment-actions">
            <button className="row-action line" onClick={() => act("POST", `/api/link-requests/${r.id}/approve`, {}, "อนุมัติแล้ว และแจ้งผู้ขอทาง LINE")}>อนุมัติ</button>
            <button className="row-action danger" onClick={() => act("POST", `/api/link-requests/${r.id}/reject`, {}, "ปฏิเสธคำขอแล้ว")}>ปฏิเสธ</button>
          </span>
        </div>
      ))}
    </section>
  );
}
