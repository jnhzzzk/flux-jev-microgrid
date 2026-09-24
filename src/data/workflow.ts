import type {
  ForecastDispatchRequest,
  MeasurementIngestRequest,
  MeasurementReceipt,
  MicrogridScenario,
} from "../../shared/contracts";

export const SITE_ID = "binhai-microgrid";

export function buildMeasurementRequest(
  scenario: MicrogridScenario,
  measuredAt: Date,
  sequence: number,
): MeasurementIngestRequest {
  const hour = measuredAt.getHours();
  const loadKW = scenario.loadKW[hour] ?? scenario.loadKW[0] ?? 0;
  const solarKW = scenario.solarKW[hour] ?? scenario.solarKW[0] ?? 0;
  const demandManagement = scenario.demandManagement;

  return {
    siteId: SITE_ID,
    measuredAt: measuredAt.toISOString(),
    sequence,
    values: {
      loadKW,
      solarKW,
      gridPowerKW: Math.max(0, loadKW - solarKW),
      batteryPowerKW: 0,
      batterySocPercent: Math.round(scenario.battery.initialSoc * 1000) / 10,
      demand15MinKW: demandManagement?.measuredDemand15MinKW,
      billingPeakToDateKW: demandManagement?.billingPeakToDateKW,
    },
  };
}

export function buildForecastRequest(
  scenario: MicrogridScenario,
  receipt: MeasurementReceipt,
  issuedAt: Date,
  useJev: boolean,
): ForecastDispatchRequest {
  const measurementTime = Date.parse(receipt.measuredAt);
  const safeIssuedAt = new Date(Math.max(issuedAt.getTime(), measurementTime));
  const horizonStart = new Date(safeIssuedAt);
  horizonStart.setHours(0, 0, 0, 0);
  const compactTime = safeIssuedAt.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);

  return {
    siteId: receipt.siteId,
    measurementId: receipt.measurementId,
    useJev,
    forecast: {
      forecastId: `fc-${compactTime}`,
      issuedAt: safeIssuedAt.toISOString(),
      horizonStart: horizonStart.toISOString(),
      resolutionMinutes: 60,
      loadKW: [...scenario.loadKW],
      solarKW: [...scenario.solarKW],
      tariffCnyPerKWh: [...scenario.tariffCnyPerKWh],
      demandManagement: scenario.demandManagement ? {
        contractedDemandKW: scenario.demandManagement.contractedDemandKW,
        controlTargetKW: scenario.demandManagement.controlTargetKW,
        demandChargeCnyPerKW: scenario.demandManagement.demandChargeCnyPerKW,
        predictedDemand15MinKW: [...scenario.demandManagement.predictedDemand15MinKW],
      } : undefined,
    },
  };
}
