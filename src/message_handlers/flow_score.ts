import { enableFlow, isFlowModeEnabled } from "../managers/FlowManager";
import { getPreference } from "../DataController";
import { commands } from 'vscode';
import { triggerChangeEvent } from '../storage/SessionSummaryData';

export async function handleFlowScoreMessage(message: any) {
  const flowModeSettings = getPreference("flowMode");

  const alreadyEnabled = await isFlowModeEnabled();

  if (flowModeSettings.editor.autoEnterFlowMode && !alreadyEnabled) {
    try {
      enableFlow({ automated: true });
    } catch (e) {
      console.error("[CodeTime] handling flow score message", e);
    }
  }
  setTimeout(() => {
    commands.executeCommand('codetime.updateViewMetrics');
    triggerChangeEvent();
  }, 1500);
}
