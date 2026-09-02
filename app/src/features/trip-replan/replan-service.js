import { state } from '../../app-core/state.js';
import { request } from '../../shared/api/client.js';
import { toast } from '../../shared/ui/toast.js';

export async function removeStop(stopId, { renderLoader, renderView, scheduleTripMap } = {}) {
  state.loading = true;
  if (renderLoader) renderLoader();
  try {
    const data = await request('/api/trip/stops', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: state.sessionId,
        operation: 'delete',
        stopId
      })
    });
    state.trip = data.trip;
    toast('已移除该站点，当天路线与耗时已自动重新计算。');
  } catch (error) {
    toast(error.message);
  } finally {
    state.loading = false;
    if (renderView) renderView();
    if (scheduleTripMap) scheduleTripMap();
  }
}

export async function confirmReplan({ renderModals, renderLoader, render, scheduleTripMap } = {}) {
  const targetStopId = state.replan;
  const reason = state.reason;

  state.loading = true;
  state.replan = null;
  if (renderModals) renderModals();
  if (renderLoader) renderLoader();
  try {
    const data = await request('/api/replan', {
      method: 'POST',
      body: JSON.stringify({ sessionId: state.sessionId, targetStopId, reason })
    });
    state.trip = data.trip;
    state.memoryProposal = data.memoryProposal;
    const replacement = data.trip?.days?.flatMap((day) => day.stops || []).find((stop) => stop.id === targetStopId);
    toast(replacement?.name ? `已成功替换为【${replacement.name}】，其余站点保持不变。` : (data.message || '行程已更新。'));
  } catch (error) {
    toast(error.message);
  } finally {
    state.loading = false;
    if (render) render();
    if (scheduleTripMap) scheduleTripMap();
  }
}
