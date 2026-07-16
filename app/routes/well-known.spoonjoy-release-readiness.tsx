import { Form } from "react-router";

const READINESS_PAYLOAD = { status: "ready" } as const;

function readinessResponse() {
  return Response.json(READINESS_PAYLOAD, {
    headers: { "Cache-Control": "no-store" },
  });
}

export function loader() {
  return readinessResponse();
}

export function action() {
  return readinessResponse();
}

export default function ReleaseReadiness() {
  return (
    <Form method="post" className="p-6">
      <button type="submit">Probe Worker mutation channel</button>
    </Form>
  );
}
