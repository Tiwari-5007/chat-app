/** Feature File Code Start */
import { FDagreementGroupSet, globalReportDateRanges, temporaryCrewAbortedDutyCodesSet } from './constant';
import { crewContractOnDate, crewEmploymentOnDate, crewHasRegion, is4ExngValid, isCrewTemporary, isPaycodePresent } from './crew-util';
import { generatePayCode, getQualificationsFromDate, getRankFromDate, reportRecords } from './time-entry-util';
import { simulatorSet } from './constant';
import { isONDuty, isSchoolFlight } from './crew-util';
import {
  getActivityMasterData,
  getAllBoughtDays,
  getAllPrivatelyTradedDays,
  getAllCrewRosterAttr,
  getActivityGroupPeriodData,
} from '../repository/time-entry/time-entry-repository';
import { checkIsCabinCrew } from './overtime';
import moment from 'moment';
import { ciStartUTC, hasCheckin, hasStandbyCallout, isStandbyCallout, legIsStandbyCallout, standbyCalloutUTC } from './standby-util';
import { log } from 'util';
import { convertHbtoUtc, diffInMinutes, hhmmToMs, msToHHMM, roundDownToDay } from './time-util';
import {isHomeStandbyWithCallout, getFirstLegWithCheckInCiStartUTC, sbySalaryHrsCallout, activeDutyTimeCallout, durationToMinutes, isBlankDay } from './standby-util';
import { lowerLimitHours, splitDutyRestSalaryReductionCont, lowerLimitHoursPerDPNKFSNKCCTempCrew } from './constant';
import { dutyTimeAcclimPeriod } from './duty-acclim-util';
import { outStationLongRestPeriodDutyHrs } from './leg-util';
import { isExceptionSZSSKNO, isCrewTemporaryOnDate, isNKFSNKOnDate } from './crew-util';
import { isCabinCrew } from './duty-overtime-util';



interface CrewRosterAttrRecord {
  attr: string;
  validFrom: string | Date;
  validTo: string | Date;
}

export const activityMasterData = await getActivityMasterData();

export const activityGroupPeriodData = await getActivityGroupPeriodData();

// Set of valid school period codes
export const validSchoolPeriodCodes = new Set(['CS', 'CS8', 'FT1', 'TH1', 'SI1', 'F20', 'BL20', 'B']);
// Set of valid school period group codes
export const validSchoolPeriodGroupCodes = new Set(['SIB']);

// this function will generate paycode for the duty's first leg if its satisfies the given condition

export async function dutyFilter(crew: any, referencedData: any) {
    let flag = false;
    let code;
    const trip = crew.Trip;
    let isActual:boolean = true; // flag to check whether ro use actual rank or not

  // Loop through each trip
  for (let i = 0; i < trip.length; i++) {
    const allDuty = trip[i].Duty;

    // Loop through each duty in the trip
    for (let j = 0; j < allDuty.length; j++) {
      // Safety check for duty and leg access
      if (!allDuty[j] || !Array.isArray(allDuty[j].Leg) || allDuty[j].Leg.length === 0) {
        console.error(`Invalid duty object or empty Leg array at trip ${i}, duty ${j} in duty-util.ts`);
        continue;
      }

      const currLeg = allDuty[j].Leg[0];
      const crewId = crew.crewId;
      const txnDate = currLeg?.scheduledTimeStart;

      try {
        // Fetch contract for the transaction date
        if (currLeg == undefined) {
          return null;
        }

        const contractOnDate = crewContractOnDate(referencedData.crewContract[crewId], txnDate);
        const contract = contractOnDate?.contract;
        const agreementgroup = referencedData.contractMaster[contract]?.agmtGroup;

        // Fetch rank data for the transaction date
        const rankData = await getRankFromDate(crew, txnDate);

        // Fetch employment data for the transaction date
        const employmentOnDate = crewEmploymentOnDate(referencedData.crewEmployment[crewId], txnDate);
        const country = employmentOnDate?.country;

        flag = false;

          // Check the conditions for generating Paycode
          if (currLeg.activityCode === 'PR' && FDagreementGroupSet.has(agreementgroup) && rankData === 'FC') {
            code = 'PR';
            flag = true;
            isActual = false; // setting flag to false for using non actual rank
          }

          if (flag === true) {
            const paycode = generatePayCode(code, '', crewId, country, rankData,isActual);

          // If Paycode is Null, skip this iteration
          if (paycode === null) {
            continue;
          }

          try {
            // Check if generated paycode is already present in wfsCorrectedData
            const isPaycodePresentFlag = await isPaycodePresent(
              crewId,
              paycode,
              referencedData.wfsCorrectedData,
              txnDate
            );

            if (!isPaycodePresentFlag) {
              currLeg.extPerKey = employmentOnDate.employmentId;
              currLeg.wfsPayCode = paycode;
              currLeg.workDay = currLeg?.scheduledTimeStart;
              currLeg.daysOff = 1;

              // Report records if paycode is not present
              try {
                const records = await reportRecords([currLeg]);
              } catch (err) {
                console.error(`Error reporting records for crewId ${crewId} on ${txnDate}:`, err);
              }
            }
          } catch (err) {
            console.error(`Error checking paycode presence for crewId ${crewId} on ${txnDate}:`, err);
          }
        }
      } catch (err) {
        console.error(`Error processing leg for crewId ${crewId} on ${txnDate}:`, err);
      }
    }
  }
}

/**
 * 
 * @param leg 
 * @returns 
 * Checks leg activity code.
 */
export async function isSimulator(leg: any) {
  try {
    const legActivityCode = leg.activityCode;
    const group = await getGroupActivityMasterById(legActivityCode);
    if(!group) {
      return false;
    }

    // Check if the leg activity code is in the simulator set
    if (simulatorSet.has(group)) {
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error checking isSimulator:', error);
    return false;
  }
}

/**
 * Determines if a flight leg is active.
 * @param leg - The flight leg object.
 * @returns A promise that resolves to true if the flight leg is active, otherwise false.
 */
export async function isActiveFlight(leg: any) {
  try {
    if (leg.activityCode === 'FLT' && leg.isActiveFlight) {
      // if active flight is True then the flight is not deadhead
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error('Error in func isActiveFlight:', error);
  }
}

/**
 * Checks if a duty has any active flights
 * @param duty - The duty object
 * @returns True if any leg in the duty is an active flight, false otherwise
 */
export async function hasActiveFlight(duty: any): Promise<boolean> {
  try {
    // Check if duty.Leg is defined and is an array
    if (!duty || !Array.isArray(duty.Leg)) {
      console.error('Invalid duty object or duty.Leg is not an array in hasActiveFlight');
      return false;
    }

    // Check if any leg is an active flight (FLT activity with isActiveFlight = true)
    return duty.Leg.some((leg: any) => leg.activityCode === 'FLT' && leg.isActiveFlight === true);
  } catch (error) {
    console.error('Error in hasActiveFlight function:', error);
    return false;
  }
}

export async function getGroupActivityMasterById(activitycode: string) {
  try {
    // Find the activity with id === activitycode
    const found = Array.isArray(activityMasterData)
      ? activityMasterData.find((activity: any) => activity.id === activitycode)
      : null;
    if (found) {
      return found.group;
    }
    return undefined;
  } catch (error) {
    console.error('Error in getGroupActivityMasterById:', error);
    throw error;
  }
}

/**
 * Enum representing different duty calculation types.
 * This enum is used to categorize the type of duty calculation for crew members.
 * It includes types like union, overtime, CAA (Crew Activity Allowance), net SKJ, and union scheduled.
 */
export enum DutyCalculation {
  union = 'union',
  overtime = 'overtime',
  caa = 'caa',
  net_skj = 'net_skj',
  union_scheduled = 'union_scheduled', // like union, but used scheduled c/o in tracking
}

// Helper functions for DutyCalculation type checks
export function isSalary(dutycalc: DutyCalculation): boolean {
  return dutycalc === DutyCalculation.overtime;
}

export function isNetSkj(dutycalc: DutyCalculation): boolean {
  return dutycalc === DutyCalculation.net_skj;
}

export function isUnionScheduled(dutycalc: DutyCalculation): boolean {
  return dutycalc === DutyCalculation.union_scheduled;
}

/**
 * Checks if a leg is simulator.
 * @param leg - The leg object
 * @returns True if the leg's group(activity) is 'PGT'
 */
export async function isPgt(leg: any) {
  const group = await getGroupActivityMasterById(leg.activityCode);
  return group === 'PGT';
}

/**
 * Checks if a leg is EMG-PGT.
 * @param leg - The leg object
 * @returns True if the leg's group(activity) is 'EMG-PGT'
 */
export async function isEmgPgt(leg: any) {
  const group = await getGroupActivityMasterById(leg.activityCode);
  return group === 'EMG-PGT';
}

/**
 *
 * @param duty
 * @returns
 * True if all legs have group 'SBY'
 */
export async function isStandBy(duty: any) {
  if (!duty.Leg || !Array.isArray(duty.Leg) || duty.Leg.length === 0) return false;
  for (const leg of duty.Leg) {
    const group = await getGroupActivityMasterById(leg.activityCode);
    if (group !== 'SBY') return false;
  }
  return true;
}

/**
 * Checks if a leg is standby line (group === 'SBL')
 * @param leg - The leg object
 * @returns True if leg has group 'SBL'
 */
export async function isStandbyLineLeg(leg: any): Promise<boolean> {
  try {
    const group = await getGroupActivityMasterById(leg.activityCode);
    return group === 'SBL';
  } catch (error) {
    console.error('Error in isStandbyLineLeg:', error);
    return false;
  }
}

/**
 * Checks if a duty is standby line
 * @param duty - The duty object
 * @returns True if duty is standby AND first leg is standby line
 */
export async function isStandbyLine(duty: any): Promise<boolean> {
  try {
    // Check if duty is standby
    const isStandbyDuty = await isStandBy(duty);
    if (!isStandbyDuty) {
      return false;
    }

    // Check if duty has legs and get the first leg
    if (!duty.Leg || !Array.isArray(duty.Leg) || duty.Leg.length === 0) {
      return false;
    }

    const firstLeg = duty.Leg[0];

    // Check if first leg is standby line
    return await isStandbyLineLeg(firstLeg);
  } catch (error) {
    console.error('Error in isStandbyLine:', error);
    return false;
  }
}

/**
 * Checks if a duty is standby at home (group === 'SBH')
 * @param duty - The duty object
 * @returns True if all legs have group 'SBH'
 */

export async function isStandByAtHome(duty: any) {
  if (!duty.Leg || !Array.isArray(duty.Leg) || duty.Leg.length === 0) return false;
  for (const leg of duty.Leg) {
    const group = await getGroupActivityMasterById(leg.activityCode);
    if (group !== 'SBH') return false;
  }
  return true;
}

/**
 * Checks if a duty is standby at a hotel (group === 'SBO')
 * @param duty - The duty object
 * @returns True if all legs have group 'SBO'
 */

export async function isStandByAtHotel(duty: any) {
  if (!duty.Leg || !Array.isArray(duty.Leg) || duty.Leg.length === 0) return false;
  for (const leg of duty.Leg) {
    const group = await getGroupActivityMasterById(leg.activityCode);
    if (group !== 'SBO') return false;
  }
  return true;
}

/**
 * Checks if all legs in duty are standby at airport (group === 'SBA') using getGroupActivityMasterById
 * @param duty - The duty object
 * @returns True if all legs have group 'SBA'
 */
export async function isStandByAtAirport(duty: any) {
  if (!duty.Leg || !Array.isArray(duty.Leg) || duty.Leg.length === 0) return false;
  for (const leg of duty.Leg) {
    const group = await getGroupActivityMasterById(leg.activityCode);
    if (group !== 'SBA') return false;
  }
  return true;
}

/**
 *
 * @param duty
 * @returns
 * This function checks if a duty is privately traded by looking for a record in the crewRosterAttr
 * array that matches the 'PRIVATELYTRADED' attribute and falls within the validFrom and validTo dates.
 * It returns true if a matching record is found, otherwise false.
 */
export async function isPrivatelyTraded(duty: any) {
  if (!duty || !duty.crewId || !duty.startUTC) return false;

  // Filter attributes for this crewId
  const crewRosterAttrList = await getAllCrewRosterAttr();
  const filterCrewRosterAttrByCrewId = crewRosterAttrList.filter((attr: any) => attr.crewId === duty.crewId);

  // Check if any record matches the PRIVATELYTRADED condition
  return filterCrewRosterAttrByCrewId.some((record: CrewRosterAttrRecord) => {
    if (record.attr !== 'PRIVATELYTRADED') return false;
    const dutyStart = new Date(duty.startUTC).getTime();
    const validFrom = new Date(record.validFrom).getTime();
    const validTo = new Date(record.validTo).getTime();
    return dutyStart >= validFrom && dutyStart <= validTo;
  });
}

/**
 *
 * @param duty
 * @param reportStartDate
 * @param reportEndDate
 * @returns
 * This function checks if the duty is within the specified report period by comparing the duty's start
 * and end times with the report start and end dates. It returns true if the duty is within the period,
 * otherwise false.
 */
export function dutyInPeriod(duty: any, reportStartDate: string, reportEndDate: string) {
  try {
    const dutyStart = new Date(duty.startUTC);
    const dutyEnd = new Date(duty.endUTC);
    const startDate = new Date(reportStartDate);
    const endDate = new Date(reportEndDate);

    // Check if the duty start and end times are within the report period
    return dutyStart >= startDate && dutyEnd <= endDate;
  } catch (error) {
    console.error('Error checking if duty is in period:', error);
    return false;
  }
}

/**
 *
 * @param startHomeBase
 * @param crewBoughtdays
 * @returns
 * This function checks if a duty is bought by comparing the start time of the duty with the
 * start and end times of the crew's bought days.
 * It returns true if the duty is bought, otherwise false.
 */
export async function isBought(startHomeBase: any, crewBoughtdays: any) {
  try {
    // Convert the startHomeBase into a Date object
    const dutyStartTime = new Date(startHomeBase);

    for (const boughtDay of crewBoughtdays) {
      const startTime = new Date(boughtDay.startTime);
      const endTime = new Date(boughtDay.endTime);

      // Check if the duty start time is between the bought day start and end times
      if (dutyStartTime >= startTime && dutyStartTime <= endTime) {
        return true;
      }
    }

    // If no matching bought day is found
    return false;
  } catch (error) {
    console.error('Error checking if duty is bought:', error);
    return false;
  }
}

/**
 *
 * @param startUTC
 * @param privatelyTradedDays
 * @param crewId
 * @returns
 * This function calculates the privately traded duty overtime for a given crew member based on the
 * start time of the duty and the privately traded days data.
 */
export async function ptdDutyOvertime(startUTC: any, privatelyTradedDays: any, crewId: string) {
  try {
    const dutyStartUTC = new Date(startUTC);
    const crewPrivatelyTradedDays = await filterPTDOverTimeByCrewId(crewId, privatelyTradedDays);

    for (const tradeDay of crewPrivatelyTradedDays) {
      const tradeDutyStart = new Date(tradeDay.dutyStart);
      const tradeDutyEnd = new Date(tradeDay.dutyEnd);

      // Check if the duty start time is between the trade day start and end times and return duty overtime
      if (dutyStartUTC >= tradeDutyStart && dutyStartUTC <= tradeDutyEnd) {
        return tradeDay.dutyOvertime;
      }
    }
    // If no matching trade day is found, return 0
    return 0;
  } catch (error) {
    console.error('Error calculating PTD duty overtime:', error);
    return 0;
  }
}

/**
 *
 * @param crewId
 * @param privatelyTradedDays
 * @returns
 * This function filters the privately traded days data based on the crewId and returns only
 * those records that match the crewId and have a dutyOvertimeType of 'OT_PART_7_CALENDAR_DAYS'.
 */

export async function filterPTDOverTimeByCrewId(crewId: string, privatelyTradedDays: any) {
  try {
    const filteredPrivatelyTradedDays = privatelyTradedDays.filter(
      (item: { crewId: string; dutyOvertimeType: string }) =>
        item.crewId === crewId && item.dutyOvertimeType == 'OT_PART_7_CALENDAR_DAYS'
    );

    return filteredPrivatelyTradedDays;
  } catch (error) {
    console.error('Error filtering privately traded days:', error);
    return [];
  }
}

/**
 *
 * @param duty
 * @param privatelyTradedDays
 * @returns
 * This function calculates the end time of a duty in UTC and rounds it up to the nearest 24:00 hours.
 * It then applies the home base time zone correction and returns the adjusted end time.
 */

export async function ptdDutyEnd(duty: any) {
  try {
    const dutyStartHomebase = new Date(duty.startHomeBase);
    const dutyEndHomebase = new Date(duty.endHomeBase);

    // Filter Privately Traded Days for this crewId
    const filterPrivatelyTradedDaysByCrewId = (await getAllPrivatelyTradedDays()).filter((day: any) => day.crewId === duty.crewId);

    for (const tradeDay of filterPrivatelyTradedDaysByCrewId) {
      const tradePeriodStart = new Date(tradeDay.periodStart);
      const tradePeriodEnd = new Date(tradeDay.periodEnd);

      // Check if the duty start time is between the trade day start and end times and return duty overtime
      if (dutyStartHomebase >= tradePeriodStart && dutyEndHomebase <= tradePeriodEnd) {
        return tradeDay.dutyEnd;
      }
    }
  } catch (error) {
    console.error('Error getting ptdDutyEnd:', error);
    return 0;
  }
}

/**
 * @param duty
 * @returns
 * This function checks if the duty is a flight duty by looking for an active flight in the duty's legs.
 * It returns true if there is an active flight, otherwise false.
 */

export async function isFlightDuty(duty: any) {
  try {
    if (!duty || !Array.isArray(duty.Leg)) {
      console.error('Invalid duty object or duty.Leg is not an array');
      return false;
    }

    let isActiveFlight = duty.Leg.some((leg: any) => leg.activityCode === 'FLT' && leg.isActiveFlight);

    return isActiveFlight;
  } catch (error) {
    console.error('Error checking in isFlightDuty:', error);
    return false;
  }
}

/**
 *
 * @param task
 * @param duty
 * @param activityMasterDataParam - Optional activity master data to avoid repeated fetches
 * @param activityGroupPeriodDataParam - Optional activity group period data to avoid repeated fetches
 * @returns
 * This function checks if the task is a ground duty by verifying if the duty is a flight duty and
 * if the task is on duty.
 */
export async function isGroundDuty(task?: any, duty?: any, activityMasterDataParam?: any, activityGroupPeriodDataParam?: any): Promise<boolean> {
  try {
    // If duty is provided and is not a flight duty, check the task conditions
    if (duty) {
      if ((await isFlightDuty(duty)) === false) {
        return false;
      }
    }

    // If task is provided, check activity type using activityMaster and activityGroupPeriod
    if (task && task.activityType) {
      const group = await getGroupActivityMasterById(task.activityType);
      
      if (group) {
        const agpData = activityGroupPeriodDataParam ?? activityGroupPeriodData;
        const filterAGPData = agpData.find((agp: any) => agp.id === group);
        
        // Check if onDuty is true from activityGroupPeriod and activity type is not 'PR'
        if (filterAGPData && filterAGPData.onDuty && task.activityType !== 'PR') {
          return true;
        }
      }
    }
    return false;
  } catch (error) {
    console.error('Error checking if duty is a ground duty:', error);
    return false;
  }
}

/**
 *
 * @param astart
 * @param aend
 * @param bstart
 * @param bend
 * @returns
 * This function calculates the overlap in minutes between two time intervals.
 * It takes the start and end times of both intervals as input and returns the overlap duration in minutes.
 */

export function overlap(astart: string, aend: string, bstart: string, bend: string): number {
  const aStart = new Date(astart);
  const aEnd = new Date(aend);
  const bStart = new Date(bstart);
  const bEnd = new Date(bend);

  const overlapStart = aStart > bStart ? aStart : bStart;
  const overlapEnd = aEnd < bEnd ? aEnd : bEnd;

  if (overlapStart >= overlapEnd) {
    return 0;
  }

  const overlapMs = overlapEnd.getTime() - overlapStart.getTime();
  const overlapMinutes = overlapMs / (1000 * 60);

  //console.log(`Overlap Minutes: ${overlapMinutes}`);

  return overlapMinutes;
}

/**
 *
 * @param duty
 * @returns
 * This function checks if the duty is a deadhead flight by looking for a leg with activity code 'FLT'
 * and checking if the flight is not active. It returns true if it is a deadhead flight, otherwise false.
 */
export async function IsDeadHead(duty: any) {
  try {
    let isDead: boolean = false;
    duty.Leg.some((leg: any) => {
      if (leg.activityCode == 'FLT' && leg.isActiveFlight == false) {
        isDead = true;
        return true;
      }
    });

    return isDead;
  } catch (error) {
    console.error('Error in IsDeadHead function:', error);
    throw error;
  }
}

/**
 * Checks if a duty has any deadhead flights
 * @param duty - The duty object
 * @returns True if any leg in the duty is a deadhead flight, false otherwise
 */
export async function hasDeadhead(duty: any): Promise<boolean> {
  try {
    // Check if duty.Leg is defined and is an array
    if (!duty || !Array.isArray(duty.Leg)) {
      console.error('Invalid duty object or duty.Leg is not an array in hasDeadhead');
      return false;
    }

    // Check if any leg is a deadhead flight (FLT activity with isActiveFlight = false)
    return duty.Leg.some((leg: any) => leg.activityCode === 'FLT' && leg.isActiveFlight === false);
  } catch (error) {
    console.error('Error in hasDeadhead function:', error);
    return false;
  }
}

/**
 * Checks if a duty has standby manual duty break (based on last leg)
 * @param duty - The duty object
 * @param referencedData - Referenced data for attributes
 * @returns True if the last leg in the duty is standby manual duty break, false otherwise
 */
export async function isSbyManualDutyBreak(duty: any): Promise<boolean> {
  try {
    // Check if duty.Leg is defined and is an array
    if (!duty || !Array.isArray(duty.Leg) || duty.Leg.length === 0) {
      return false;
    }

    // Get the last leg of the duty
    const lastLeg = duty.Leg[duty.Leg.length - 1];

    // Check if the last leg is standby at airport AND has duty break attribute
    const isStandbyAtAirport = await isStandByAtAirport(duty);
    const hasDutyBreakAttribute = await legHasDutyBreakAttribute(lastLeg);

    return isStandbyAtAirport && hasDutyBreakAttribute;
  } catch (error) {
    console.error('Error in isSbyManualDutyBreak:', error);
    return false;
  }
}

/**
 * Gets the rest time after the duty
 * @param duty - The duty object
 * @returns Rest time string or null
 */
export async function getDutyRestTime(duty: any): Promise<string | null> {
  try {
    // Placeholder implementation - you'll need to replace this with actual logic
    return duty.restTime || duty.restTimeAfter || null;
  } catch (error) {
    console.error('Error in getDutyRestTime:', error);
    return null;
  }
}

/**
 * Gets the rest time before the duty
 * @param duty - The duty object
 * @returns Rest time string or null
 */
export async function getDutyRestTimeBeforeDuty(duty: any): Promise<string | null> {
  try {
    // Placeholder implementation - you'll need to replace this with actual logic
    return duty.restTimeBefore || duty.restTimeBeforeDuty || null;
  } catch (error) {
    console.error('Error in getDutyRestTimeBeforeDuty:', error);
    return null;
  }
}

/**
 * Gets the next duty in the chain
 * @param dutyChain - Array of duties
 * @param currentIndex - Current duty index
 * @returns Next duty or null
 */
export function getNextDuty(dutyChain?: any[], currentIndex?: number): any | null {
  if (!dutyChain || currentIndex === undefined || currentIndex >= dutyChain.length - 1) {
    return null;
  }
  return dutyChain[currentIndex + 1];
}

/**
 * Gets the previous duty in the chain
 * @param dutyChain - Array of duties
 * @param currentIndex - Current duty index
 * @returns Previous duty or null
 */
export function getPrevDuty(dutyChain?: any[], currentIndex?: number): any | null {
  if (!dutyChain || currentIndex === undefined || currentIndex <= 0) {
    return null;
  }
  return dutyChain[currentIndex - 1];
}

// Method to check if the activity is a meeting by checking if the activity code is 'MET'
export async function isMeeting(activity: any, type: any) {
  try {
    const activityData = activityMasterData;
    let activityCode = type === 'task' ? activity?.activityType : activity.dutyCode;
    // Find the activity with id === activityCode
    const found = Array.isArray(activityData)
      ? activityData.find((item: any) => item.id === activityCode)
      : null;
    const group = found?.group;
    //console.log('activityCode-------',activityCode,'found-------',found,'group-------',group);
    const isMET = group === 'MET';
    //console.log('isMeeting------------','activity-----------',activity.dateOfOperation, 'type------------',type, activityCode, 'group-------', group, 'isMET-------', isMET);
    return isMET;
  } catch (error) {
    console.error('Error in isMeeting function:', error);
    throw new Error('Error in isMeeting function');
  }
}

/**
 * Checks if a duty is a valid school activity for overtime exclusion.
 * @param duty - The duty object
 * @param activityMasterData - Optional activity master data to avoid repeated fetches
 * @returns True if the duty is a valid school activity, false otherwise
 */

export async function dutyIsValidSchoolActivity(duty: any) {
  if (!duty || !Array.isArray(duty.Leg) || !has_restr_training_leg_start()) return false;

  const activityData = activityMasterData;

  for (const leg of duty.Leg) {
    const isFlightActive = leg.activityCode;
    const flightCarrier = leg.carrier;
    const getflightNr = leg.activity;
    const parts = getflightNr.split(' ');
    let flightNr = '';
    // Check if there are at least two parts
    if (parts.length > 1) {
      // Return the second part
      flightNr = parts[1];
    }

    if (await isSimulator(leg)) return true;

    if (await isPgt(leg)) return true;

    if (await isEmgPgt(leg)) return true;

    if (await isSchoolFlight(flightCarrier, flightNr)) return true;

    // IsDeadHead: async helper, expects duty, so wrap leg in a dummy duty
    if (await IsDeadHead({ Leg: [leg] })) return true;

    // code in validSchoolPeriodCodes
    if (leg.code && validSchoolPeriodCodes.has(leg.code)) return true;

    // group_code in validSchoolPeriodGroupCodes
    if (leg.group_code && validSchoolPeriodGroupCodes.has(leg.group_code)) return true;
  }
  return false;
}

function has_restr_training_leg_start() {
  // placeholder method , ayan will discuss with priyanka regarding this.
  return true;
}

/**
 * Checks if a duty is not valid for overtime based on meeting and hasActiveFlight rules.
 *
 * @param duty - The duty object
 * @param activityMasterData - Optional activity master data to avoid repeated fetches
 * @returns True if the duty is not valid for overtime, false otherwise
 */
export async function dutyIsNotValidOvertime(duty: any, activityMasterData?: any): Promise<boolean> {
  const activityData = activityMasterData;
  const notValidOT = await isMeeting(duty, 'duty') && !(await hasActiveFlight(duty)) || (await dutyIsValidSchoolActivity(duty));
  return notValidOT;
}

/**
 * Calculates the rest time before a duty in HH:mm format
 * @param duty - The current duty object
 * @param prevDuty - The previous duty object (can be null)
 * @returns Rest time before duty as a string in 'HH:mm' format
 */
export async function restTimeBeforeDuty(duty: any, prevDuty: any): Promise<string> {
  // Get start and end of rest period
  const restStart = await restStartBeforeDuty(duty, prevDuty);
  const restEnd = restEndBeforeDuty(duty);

  // Convert to Date objects
  const startDate = new Date(restStart);
  const endDate = new Date(restEnd);
  // Calculate difference in minutes
  let diffMs = endDate.getTime() - startDate.getTime();
  if (diffMs < 0) diffMs = 0;
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export async function restStartBeforeDuty(duty: any, prevDuty: any) {
  if (prevDuty && ! await restDuty(prevDuty)) {
    // Format prevDuty.endUTC as 'YYYY-MM-DD HH:mm'
    const end = new Date(prevDuty.endUTC);
    const year = end.getFullYear();
    const month = String(end.getMonth() + 1).padStart(2, '0');
    const day = String(end.getDate()).padStart(2, '0');
    const hours = String(end.getHours()).padStart(2, '0');
    const minutes = String(end.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } else {
    // Subtract 900 minutes (15 hours) from duty.startUTC and format as 'YYYY-MM-DD HH:mm'
    const start = new Date(duty.startUTC);
    const minus900 = new Date(start.getTime() - 900 * 60 * 1000);
    // Format as 'YYYY-MM-DD HH:mm'
    const year = minus900.getFullYear();
    const month = String(minus900.getMonth() + 1).padStart(2, '0');
    const day = String(minus900.getDate()).padStart(2, '0');
    const hours = String(minus900.getHours()).padStart(2, '0');
    const minutes = String(minus900.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }
}

export function restEndBeforeDuty(duty: any) {
  return duty.startUTC;
}

// rest time is same as restTime after duty
export async function restTime(duty: any, nextDuty: any) {

  //console.log('Calculating rest time for current duty:', duty, 'nextDuty:', nextDuty);

  const restStart = restStartAfterDuty(duty);
  const restEnd = await restEndAfterDuty(duty, nextDuty);
  // Convert to Date objects
  const startDate = new Date(restStart);
  const endDate = new Date(restEnd);
  
  // Calculate difference in milliseconds
  let diffMs = endDate.getTime() - startDate.getTime();
  //console.log('Difference in milliseconds:', diffMs);
  
  if (diffMs < 0) diffMs = 0;
  
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  
  return `${hours}:${minutes}`;
}

export async function restEndAfterDuty(duty: any, nextDuty: any) {
  if (nextDuty && !await restDuty(nextDuty)) {
    // console.log('nextDuty startutc 2---------.', nextDuty.startUTC);
    return nextDuty.startUTC;
  } else {
    return duty.startUTC;
  }
}

export function restStartAfterDuty(duty: any) {
  return duty.endUTC;
}

export async function restDuty(duty: any) {
  // Check if duty is null or undefined
  if (!duty) {
    return false;
  }

  if (duty.dutyCode && duty.dutyCode === "W") {
    return false;
  }

  // Guard for undefined global
  if (typeof activityMasterData === 'undefined' || !Array.isArray(activityMasterData)) {
    return false;
  }

  const activityMaster = activityMasterData.find((am: any) => am.id === duty.dutyCode);
  if (activityMaster && activityMaster.group && typeof activityGroupPeriodData !== 'undefined' && Array.isArray(activityGroupPeriodData)) {
    const group = activityMaster.group;
    const filterAGPData = activityGroupPeriodData.find((agp: any) => agp.id === group);
    return filterAGPData ? filterAGPData.dayOff : false;
  }

  return false;
}


/**
 *
 * @param leg
 * @returns
 *
 */
export async function isStandByAtAirportInLeg(leg: any) {
  if (!leg || !leg.activityCode) return false;
  const group = await getGroupActivityMasterById(leg.activityCode);
  return group === 'SBA';
}

/**
 * Checks if a leg has the duty break attribute.
 * @param leg - The leg object to check.
 * @returns True if the leg has the duty break attribute, false otherwise.
 */
export function legHasDutyBreakAttribute(leg: any) {
  if (leg?.attribute?.flightDutyAttr == 'DUTY_BREAK') {
    return true;
  }
  return false;
}

/**
 * Returns the start UTC for a duty period, using the previous duty's start UTC if not first in period.
 * Implements:
 *   if not is_first_duty_in_duty_period then prev(duty(chain), duty.start_utc) else duty.start_utc
 * @param duty The current duty object
 * @param dutyChain The array of duties (duty period)
 * @returns {Promise<string>} The start UTC string
 */
// export async function startUTCInDutyPeriod(duty: any, dutyChain: any[]): Promise<string> {
//   try {
//     const currentDutyIndex = dutyChain.findIndex((d: any) => d === duty);
//     console.log('Current Duty Index:', currentDutyIndex);
//     if (currentDutyIndex === -1) {
//       console.error('Current duty not found in duty chain');
//       return duty?.startUTC || '';
//     }
//     const isFirst = await isFirstDutyInDutyPeriod(duty, dutyChain);
//     console.log('Current Duty Index:', currentDutyIndex);
//     if (!isFirst && currentDutyIndex > 0) {
//       const prevDuty = dutyChain[currentDutyIndex - 1];
//       return prevDuty?.startUTC || duty?.startUTC || '';
//     } else {
//       return duty?.startUTC || '';
//     }
//   } catch (error) {
//     console.error('Error in start_utc:', error);
//     return duty?.startUTC || '';
//   }
// }

/**
 * Checks if the given duty is the first duty in a duty period.
 * Implements: default(prev(duty(wop), is_last_duty_in_duty_period), true)
 * @param duty The current duty object
 * @param dutyChain The array of duties (duty period)
 * @returns {Promise<boolean>} True if first in duty period, else false
 */
export async function isFirstDutyInDutyPeriod(duty: any, dutyChain: any[]): Promise<boolean> {
  try {
    const currentDutyIndex = dutyChain.findIndex((d: any) => d === duty);
    if (currentDutyIndex === -1) {
      console.error('Current duty not found in duty chain');
      return false;
    }
    if (currentDutyIndex === 0) {
      // No previous duty, so default to true
      return true;
    }
    const prevDuty = dutyChain[currentDutyIndex - 1];
    return await isLastDutyInDutyPeriod(prevDuty, dutyChain);
  } catch (error) {
    console.error('Error in isFirstDutyInDutyPeriod:', error);
    return false;
  }
}

/**
 *
 * @param duty
 * @param dutyChain
 * @returns
 * This function checks if the given duty is the last duty in a duty period according to FDP and rest rules.
 */
export async function isLastDutyInDutyPeriod(duty: any, dutyChain: any[]): Promise<boolean> {
  try {
    //console.log('dutyChain---------------:', dutyChain);
    const currentDutyIndex = dutyChain.findIndex((d: any) => d === duty);
    if (currentDutyIndex === -1) {
      console.error('Current duty not found in duty chain');
      return false;
    }

    const isFdpResult = await isFdp(duty, dutyChain);
    
    if (isFdpResult) {

      // Get next duty in chain
      const nextDuty = currentDutyIndex < dutyChain.length - 1 ? dutyChain[currentDutyIndex + 1] : null;


     
      // restTime between this duty and next
      let restTimeVal: string | null = null;
      if (nextDuty) {
        restTimeVal = await restTime(duty, nextDuty);
      }

      // If restTime >= 10:00, return true
      if (restTimeVal !== null) {
        const [h, m] = restTimeVal.split(':').map(Number);
        const restMinutes = h * 60 + m;
        if (restMinutes >= 600) {
          return true;
        }
      }
      // If next duty is not FDP, or no next duty, return true
      if (!nextDuty) {
        return true;
      }
      const isNextFdp = await isFdp(nextDuty, dutyChain);
      if (!isNextFdp) {
        return true;
      }
      // Otherwise, not last in duty period
      return false;
    } else {
      return true;
    }
    // Old Logic Ends

  } catch (error) {
    console.error('Error in isLastDutyInDutyPeriod:', error);
    return false;
  }
}

/**
 * Returns the end UTC for a duty period, using the next duty's end UTC if not last in period.
 * Implements:
 *   if not is_last_duty_in_duty_period then next(duty(chain), duty.end_utc) else duty.end_utc
 * @param duty The current duty object
 * @param dutyChain The array of duties (duty period)
 * @returns {Promise<string>} The end UTC string
 */
export async function endUTCInDutyPeriod(duty: any, dutyChain: any[]): Promise<string> {
  try {
    const currentDutyIndex = dutyChain.findIndex((d: any) => d === duty);
    if (currentDutyIndex === -1) {
      console.error('Current duty not found in duty chain');
      return duty?.endUTC || '';
    }
    // Use isLastDutyInDutyPeriod from this file
    const isLast = await isLastDutyInDutyPeriod(duty, dutyChain);
    if (!isLast && currentDutyIndex < dutyChain.length - 1) {
      const nextDuty = dutyChain[currentDutyIndex + 1];
      return nextDuty?.endUTC || duty?.endUTC || '';
    } else {
      return duty?.endUTC || '';
    }
  } catch (error) {
    console.error('Error in endUTCInDutyPeriod:', error);
    return duty?.endUTC || '';
  }
}

/**
 * Checks if a duty is FDP (Flight Duty Period)
 * @param duty - The current duty object
 * @param dutyChain - Array of duties in the chain for checking next/prev duties
 * @returns True if duty qualifies as FDP, false otherwise
 */
export async function isFdp(duty: any, dutyChain: any[]): Promise<boolean> {
  try {
    // Find the index of the current duty in the duty list
    let dutyIndex = dutyChain.findIndex((d: any) => d === duty);
    const previousDuty = dutyIndex > 0 ? dutyChain[dutyIndex - 1] : null;
    const nextDuty = dutyIndex < dutyChain.length - 1 ? dutyChain[dutyIndex + 1] : null;

    // const restTimeCal = await restTime(duty, nextDuty);

    // Check if duty is on duty
    const isOnDuty = await isONDuty(duty);
    if (!isOnDuty) {
      return false;
    }

    // Check if duty has active flight
    const hasActiveFlightInDuty = await hasActiveFlight(duty);
    if (hasActiveFlightInDuty) {
      return true;
    }

    // Check standby manual duty break or deadhead conditions
    const isSbyManualBreak = await isSbyManualDutyBreak(duty);
    const hasDeadheadInDuty = await hasDeadhead(duty);

    if (isSbyManualBreak || hasDeadheadInDuty) {
      // Check rest time conditions
      const restTimeVal = nextDuty ? await restTime(duty, nextDuty) : null;
      const restTimeBeforeDutyVal = previousDuty ? await restTimeBeforeDuty(duty, previousDuty) : null;

      let hasShortRestWithActiveFlight = false;

      //Check if rest time < 10:00 and next duty has active flight
      if (restTimeVal !== null && (await convertTimeToMinutes(restTimeVal)) < 600) {
        if (nextDuty && (await hasActiveFlight(nextDuty))) {
          hasShortRestWithActiveFlight = true;
        }
      }

      //Check if rest time before duty < 10:00 and prev duty has active flight
      if (restTimeBeforeDutyVal !== null && (await convertTimeToMinutes(restTimeBeforeDutyVal)) < 600) {
        if (previousDuty && (await hasActiveFlight(previousDuty))) {
          hasShortRestWithActiveFlight = true;
        }
      }

      return hasShortRestWithActiveFlight;
    }

    return false;
  } catch (error) {
    console.error('Error in isFdp function:', error);
    return false;
  }
}

/**
 * Converts time string to minutes
 * @param time - Time string in HH:MM format
 * @returns Time in minutes
 */
async function convertTimeToMinutes(time: string): Promise<number> {
  try {
    const isNegative = time.startsWith('-');
    const [hours, minutes] = time.replace('-', '').split(':').map(Number);
    const totalMinutes = hours * 60 + minutes;
    return isNegative ? -totalMinutes : totalMinutes;
  } catch (error) {
    console.error('Error converting time to minutes:', error);
    return 0;
  }
}

/**
 * Converts minutes to 'HH:mm' format.
 * @param minutes - Number of minutes
 * @returns Time string in 'HH:mm' format
 */
export function convertMinutesToTime(minutes: number): string {
  const isNegative = minutes < 0;
  const absMinutes = Math.abs(minutes);
  const hours = Math.floor(absMinutes / 60);
  const mins = absMinutes % 60;
  const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  return isNegative ? `-${timeStr}` : timeStr;
}

export function privatelyTradedDtPart(duty: any) {
  return null;
}

export const minDutyForNetReductionSkj = 300; // 5:00 hr val in min
export const netDutyReductionFlightDutySkj = 120; // 2:00 hr val in min
export const netDutyReductionGroundDutySkj = 60; // 1:00 hr val in min

/**
 *
 * @param duty
 * @param startDate -- overTime7CalendarDaysStart
 * @param endDate -- overTime7CalendarDaysEnd
 * @returns
 * Calculates net reduction SKJ OMA16 for a duty within a given interval.
 * Returns reduction in minutes (number).
 */
export async function netReductionSkjOma16(duty: any, startDate: string, endDate: string): Promise<number> {
  // Convert dates to Date objects for comparison
  const dutyStart = new Date(duty.startUTC);
  const dutyEnd = new Date(duty.endUTC);
  const intervalStart = new Date(startDate);
  const intervalEnd = new Date(endDate);

  // Duty fully within interval
  if (dutyStart >= intervalStart && dutyEnd <= intervalEnd) {
    // Check for active flight with sufficient block time
    for (const leg of duty.Leg) {
      if (leg.isActiveFlight) {
        return netDutyReductionFlightDutySkj;
      }
    }
    // Check for ground duty with sufficient time
    for (const leg of duty.Leg) {
      if (!(isFlightDutyInLeg(leg) || (await isStandByInLeg(leg)))) {
        return netDutyReductionGroundDutySkj;
      }
    }
    return 0;
  } else {
    // Check for active flight with sufficient overlap
    for (const leg of duty.Leg) {
      if (leg.isActiveFlight && overlap(leg.startUTC, leg.endUTC, startDate, endDate) > minDutyForNetReductionSkj) {
        return netDutyReductionFlightDutySkj;
      }
    }
    // Check for ground duty with sufficient overlap
    for (const leg of duty.Leg) {
      if (!(isFlightDutyInLeg(leg) || (await isStandByInLeg(leg))) && overlap(duty.startUTC, duty.endUTC, startDate, endDate) > minDutyForNetReductionSkj) {
        return netDutyReductionGroundDutySkj;
      }
    }
    return 0;
  }
}

/**
 * 
 * @param leg 
 * @returns 
 * Placeholder function, always returns 0
 */
export function timeInLeg(leg: any) {
  return 0;
}

/**
 * 
 * @param leg 
 * @returns 
 * Placeholder function, always returns 0
 */

export function isFlightDutyInLeg(leg: any) {
  return 0;
}

/**
 *
 * @param duty
 * @returns
 * True if all legs have group 'SBY'
 */
export async function isStandByInLeg(leg: any) {
  if (!leg || !leg.activityCode) return false;
  const group = await getGroupActivityMasterById(leg.activityCode);
  return group === 'SBY';
}

/**
 * This function calculates the split duty hours for a given crew, crew rank, activity, duty, and referenced data. It uses the tempDutyTimeOnCalenderDayHB function to calculate the duty time on a calendar day based on home base time and logs the result.
 * @param crew - The crew object containing crew details.
 * @param crewRank - The rank of the crew member.
 * @param activity - The activity object containing the duty.
 * @param duty - The duty object for which to calculate the split duty hours.
 * @param referencedData - Additional data referenced for the calculation.
 * @returns The calculated split duty hours in milliseconds.
 */
export async function calculateSplitDutyHours(crew: any,crewRank:any, activity: any, duty: any, referencedData: any){
  try {
    if(!crew || !activity || !duty || !crewRank || !referencedData) {
      throw new Error('Missing required parameters: crew, activity, duty, crewRank, or referencedData');
    }

    const dutyOvertime: DutyCalculation  = DutyCalculation.overtime;
    const result = await tempDutyTimeOnCalenderDayHB(crew, crewRank, activity, duty, referencedData, dutyOvertime);
    return result;
  } catch (error) {
    console.log("Error in calculateSplitDutyHours:", error);
    return 0;
  }
}

/**
 * This function calculates the duty time on a calendar day based on home base time for a given duty. It considers the crew's region (SKS) and calculates the overlap of the duty with the calendar day in home base time. It also accounts for any cancelled production time within that period.
 * @param crew - The crew object containing crew details.
 * @param crewRank - The rank of the crew member.
 * @param activity - The activity object containing the duty.
 * @param duty - The duty object for which to calculate the time on calendar day.
 * @param referencedData - Additional data referenced for the calculation.
 * @param dutyOvertime - The duty overtime calculation type.
 * @returns The calculated duty time on the calendar day in milliseconds.
 */
export async function tempDutyTimeOnCalenderDayHB(crew: any, crewRank:any, activity: any, duty: any, referencedData: any, dutyOvertime: DutyCalculation){
  try {
    if(!crew || !activity || !duty || !crewRank || !referencedData || !dutyOvertime) {
      throw new Error('Missing required parameters: crew, activity, duty, crewRank, referencedData, or dutyOvertime');
    }

    const offSetInMinutes = diffInMinutes(duty.startHomeBase, duty.startUTC);
    const dutyStartDayHB  = roundDownToDay(duty.startHomeBase);
    const startDateTime   = convertHbtoUtc(dutyStartDayHB, offSetInMinutes);
    const endDateTime     = new Date(startDateTime.getTime() + 24 * 60 * 60 * 1000);
    const isSKS:boolean = crewHasRegion(crew, "SKS");
    
    if(isSKS){ 
      if(duty.startUTC.getTime() >= endDateTime.getTime()){
        return 0;
      }
      // Rave: overlap > 0
      const overlap =
        Math.max(
          0,
          Math.min(duty.endUTC.getTime(), endDateTime.getTime()) -
          Math.max(duty.startUTC.getTime(), startDateTime.getTime())
        );
  
      if (overlap <= 0) {
        return 0;
      }
  
      const result = await tripDutyTimeInPeriodTempSKS(startDateTime, endDateTime, dutyOvertime, false, crew, crewRank, duty, activity, referencedData);
      const cancelledTime =
        await tempProductionCancelledTimeInPeriod(
          startDateTime,
          endDateTime,
          duty
        ) ?? 0;
  
      return Math.max(result, cancelledTime);
    } else {
      return 0;
    }
  } catch (error) {
    console.log("Error in tempDutyTimeOnCalenderDayHB:", error);
    return 0;
  }
}

/**
 * This function calculates the cancelled production time for a specific period.
 * @param startDateTime - The start date and time of the period to check for cancelled production time.
 * @param endDateTime - The end date and time of the period to check for cancelled production time.
 * @param duty - The duty object for which to calculate the cancelled production time.
 * @returns The total cancelled production time for the specified period.
 * Note: This is a placeholder implementation and should be replaced with actual logic to calculate cancelled production time based on the duty and the specified period.
 */
export async function tempProductionCancelledTimeInPeriod(startDateTime: Date, endDateTime: Date, duty: any): Promise<number> {
  try {
    if(!duty || !duty.Leg || !Array.isArray(duty.Leg)) {
      throw new Error('Invalid duty object or duty.Leg is not an array');
    }
    return 0;
  } catch (error) {
    console.error('Error in tempProductionCancelledTimeInPeriod function:', error);
    return 0;
  }
}

/**
 * This function calculates the trip duty time for a specific period.
 * @param startDateTime - The start date and time of the period to check for trip duty time.
 * @param endDateTime - The end date and time of the period to check for trip duty time.
 * @param dutyOvertime - The duty overtime calculation type.
 * @param overtime - A boolean indicating if overtime should be considered.
 * @param crew - The crew object.
 * @param crewRank - The crew rank.
 * @param duty - The duty object for which to calculate the trip duty time.
 * @param activity - The activity object containing the duty.
 * @param referencedData - Additional data referenced for the calculation.
 * @returns The total trip duty time for the specified period.
*/
export async function tripDutyTimeInPeriodTempSKS(startDateTime: Date, endDateTime: Date, dutyOvertime: DutyCalculation, overtime: boolean, crew: any, crewRank: any, duty: any, activity: any, referencedData: any){
  try {
    if(!startDateTime || !endDateTime || !dutyOvertime || !crew || !crewRank || !duty || !activity || !referencedData) {
      throw new Error('Missing required parameters');
    }
    if(!activity || !activity.Duty || activity.Duty.length === 0){
      throw new Error('Activity has no duties');
    }
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const dutiesList = activity.Duty;
    const sortedDuties = [...dutiesList].sort((a, b) => new Date(a.startHomeBase).getTime() - new Date(b.startHomeBase).getTime());
    const startHbFirstDuty = new Date(sortedDuties[0].startHomeBase);
    const endHbLastDuty = new Date(sortedDuties[sortedDuties.length - 1].endHomeBase);
    const startDay = roundDownToDay(startHbFirstDuty);
    const endMinusOneMinute = new Date(endHbLastDuty.getTime() - 60 * 1000);
    const endDay = roundDownToDay(endMinusOneMinute);
    const tripDays = ((endDay.getTime() - startDay.getTime()) + ONE_DAY) / ONE_DAY;
    let total = 0;
    const reportStartDate = globalReportDateRanges.globalStartDate;
    const is4Exng = is4ExngValid(referencedData, reportStartDate, crew, crewRank);

    const dutyTimeLimit = is4Exng ? 999 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
    for (let i = 0; i < tripDays; i++) {
      const dayIndex = i + 1;
      let dayValue = await tripDutyTimeInPeriodTempSKSDay(startDateTime, endDateTime, dayIndex, duty, crew, activity, referencedData);
      if (dutyOvertime === "overtime") {
        if (!overtime) {
          total += Math.min(dayValue, dutyTimeLimit);
        } else {
          total += Math.max(0, dayValue - dutyTimeLimit);
        }
      } else {
        total += dayValue;
      }
    }
    return total;
  } catch (error) {
    console.log("Error in tripDutyTimeInPeriodTempSKS:", error);
    return 0;
  }
}

/**
 * This function calculates the trip duty time for a specific day index within a given period.
 * @param startDateTime - The start date and time of the period to check for trip duty time.
 * @param endDateTime - The end date and time of the period to check for trip duty time.
 * @param dayIndex - The index of the day within the period for which to calculate the trip duty time (1 for the first day, 2 for the second day, etc.).
 * @param duty - The duty object for which to calculate the trip duty time.
 * @param crew - The crew Object.
 * @param activity - The activity object containing the duty.
 * @param referencedData - Additional data referenced for the calculation.
 * @returns - The calculated trip duty time for the specified day index within the period in milliseconds.
*/
export async function tripDutyTimeInPeriodTempSKSDay(startDateTime: Date, endDateTime: Date, dayIndex: number, duty: any, crew: any, activity: any, referencedData: any) {
  try {
    if(!startDateTime || !endDateTime || !dayIndex || !duty || !crew || !activity || !referencedData) {
      throw new Error('Missing required parameters');
    }
    const st = new Date(roundDownToDay(activity.startHomeBase).getTime() + (dayIndex - 1) * 24 * 60 * 60 * 1000);
    const et = new Date(roundDownToDay(activity.startHomeBase).getTime() + dayIndex * 24 * 60 * 60 * 1000);
    if (st.getTime() < startDateTime.getTime() || st.getTime() >= endDateTime.getTime()) {
      return 0;
    } else {
      return await tripDutyTimeInPeriodTempSKSDayHelper(st, et, crew, duty, activity, referencedData);
    }
  } catch (error) {
    console.error('Error in tripDutyTimeInPeriodTempSKSDay function:', error);
    return 0;
  }
}

/**
 * This function calculates the trip duty time for a specific day within a given period.
 * @param st - The start time of the day for which to calculate the trip duty time.
 * @param et - The end time of the day for which to calculate the trip duty time.
 * @param crew - The crew object for which to calculate the trip duty time.
 * @param duty - The duty object for which to calculate the trip duty time.
 * @param activity - The activity object containing the duty.
 * @param referencedData - Additional data referenced for the calculation.
 * @returns - The calculated trip duty time for the specified day within the period in milliseconds, considering various conditions and a minimum guarantee if applicable.
 */
export async function tripDutyTimeInPeriodTempSKSDayHelper(st: Date, et: Date, crew: any, duty: any, activity: any, referencedData: any) {
  try {
    if(!st || !et || !crew || !duty || !activity || !referencedData) {
      throw new Error('Missing required parameters');
    }
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    let prevDutyTimeRaw = 0;
    let dutyTimeRaw     = await calculateTripDutyTimeInPeriodTempSKS(crew, duty, activity, referencedData, st, et);

    const currentDutyIndex = activity.Duty.findIndex((d: any) => d === duty);
    if(currentDutyIndex > 0){
      const previousDutyObj = activity.Duty[currentDutyIndex - 1];
      prevDutyTimeRaw = await calculateTripDutyTimeInPeriodTempSKS(crew, previousDutyObj, activity, referencedData, st, et);
    }
    
    if (dutyTimeRaw === 0 && prevDutyTimeRaw === 0) {
      return 0;
    }
    const hasLaterTripOnSameDayFlag = await hasLaterTripOnSameDay(duty, activity?.Duty, et);
    const isTripIsInitialCourse     = tripIsInitialCourseDuty(crew, activity, duty, referencedData);
    const hasIllnessWithinTimeFlag  = hasIllnessWithinTime(duty);

    const isOnDutyFlag = await isONDuty(duty);
    const qualifiesForMinimum = isOnDutyFlag && !hasLaterTripOnSameDayFlag &&!isTripIsInitialCourse && !hasIllnessWithinTimeFlag;
    let minimumGuarantee = 0;
    if (qualifiesForMinimum) {
      minimumGuarantee = Math.max(
        0,
        FOUR_HOURS_MS - prevDutyTimeRaw
      );
    }
    return Math.max(dutyTimeRaw, minimumGuarantee);
  } catch (error) {
    console.error('Error in tripDutyTimeInPeriodTempSKSDayHelper function:', error);
    return 0;
  }
}

/**
 * This function checks if there is any illness-related duty code within the legs of the given duty.
 * @param duty - The duty object.
 * @returns - A boolean value indicating whether there is an illness-related duty code within the time frame of the duty.
*/
export function hasIllnessWithinTime(duty: any): boolean {
  if (!duty?.Leg || !Array.isArray(duty.Leg)) return false;
  for (let i = 0; i < duty.Leg.length; i++) {
    const dutyLeg = duty.Leg[i];
    if (temporaryCrewAbortedDutyCodesSet.has(dutyLeg.code)) {
      return true;
    }
  }
  return false;
}

/**
 * This function checks if there is a later trip on the same day for the given duty within the duty roster. It iterates through the duties in the duty roster starting from the current duty's index and checks if any subsequent duty is an ON duty that starts before the end time of the current duty.
 * @param duty - The current duty object for which to check for later trips on the same day. 
 * @param dutyRoster - An array of duty objects representing the duty roster for the crew member.
 * @param endTime - The end time of the current duty, used to compare with the start times of subsequent duties in the roster.
 * @returns - A boolean value indicating whether there is a later trip on the same day for the given duty within the duty roster.
*/
export async function hasLaterTripOnSameDay(duty: any, dutyRoster: any[], endTime: Date): Promise<boolean> {
  try {
    if(!duty || !dutyRoster || !Array.isArray(dutyRoster) || dutyRoster.length === 0 || !endTime) {
      throw new Error('Missing required parameters: duty, dutyRoster, or endTime');
    }
    const currentIndex = dutyRoster.findIndex(t => t.id === duty.id);

    if(currentIndex === -1) {
      throw new Error('Current duty not found in duty roster');
    }
  
    for (let i = currentIndex + 1; i < dutyRoster.length; i++) {
      const nextDuty = dutyRoster[i];
      if (await isONDuty(nextDuty) && nextDuty.startHomeBase.getTime() < endTime.getTime()) {
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('Error in hasLaterTripOnSameDay function:', error);
    return false;
  }
}

/**
 * This function calculates the trip duty time in a given period for SKS contract crew, based on several conditions such as whether the trip is an initial course, if it's the first duty in the duty period, and specific agreement validity.
 * @param crew - The whole crew Object.
 * @param duty - The whole duty Object.
 * @param activity - The whole activity Object.
 * @param referencedData - The whole referencedData Object.
 * @param startTime - The start time of the period for which to calculate the duty time.
 * @param endTime - The end time of the period for which to calculate the duty time.
 * @returns The calculated duty time in minutes.
*/
export async function calculateTripDutyTimeInPeriodTempSKS(crew: any, duty: any, activity: any, referencedData: any, startTime: Date, endTime: Date){
  try {
    // Add Validations for all the arguments coming to this Function
    if (!duty || !crew || !activity || !referencedData || !startTime || !endTime) {
      console.error("Mandatory arguments missing");
      return 0;
    }
    const isTripIsInitialCourse = tripIsInitialCourseDuty(crew, activity, duty, referencedData);
    if(isTripIsInitialCourse){
      return 0;
    }
    const isFirstDuty = await isFirstDutyInDutyPeriod(duty, activity?.Duty);
    if(
      isFirstDuty && 
      new Date(duty.dutyPeriodStartUTC).getTime() >= startTime.getTime() &&
      new Date(duty.dutyPeriodStartUTC).getTime() < endTime.getTime()
    ) {
      let sum = 0;
      sum += await dutyTimeSksCcTemp(activity, crew, duty, referencedData);
      return sum;
    } else {
      return 0;
    }
  } catch (error) {
    console.error("Error in calculateTripDutyTimeInPeriodTempSKS:", error);
    return 0;
  }
}

/**
 * This function checks if a given duty is an initial course duty for a crew member based on specific conditions such as the duty code group, last flown date, and crew qualifications.
 * @param crew - The whole crew Object.
 * @param duty - The whole duty Object.
 * @param referencedData - The whole referencedData Object.
 * @returns A boolean indicating whether the duty is an initial course duty.
*/
export function tripIsInitialCourseDuty(crew: any, activity: any, duty: any, referencedData: any) {
  try {
    if(!duty || !crew || !Array.isArray(crew.validQualifications) || !referencedData || !Array.isArray(crew.validQualifications)) {
      throw new Error('Missing or invalid parameters: duty, crew, crew.validQualifications, or referencedData');
    }

    if(referencedData.activityMaster === undefined) {
      throw new Error('Missing activityMaster in referencedData');
    }
    
    let code = activity.tripCode || duty.dutyCode || null;
    if(!code) {
      throw new Error('Missing dutyCode in duty object');
    }
    const BASELINE_DATE = new Date("1986-01-01T00:00:00Z").getTime();
    const group = referencedData?.activityMaster[code]?.group || null;
    const isCourse = group === "COD";
    const lastFlown = Array.isArray(duty.Leg) && duty.Leg.length > 0 && duty.Leg[0].lastFlown ? duty.Leg[0].lastFlown : null;
    if(!lastFlown || lastFlown && isNaN(new Date(lastFlown).getTime())) {
      throw new Error(`Invalid lastFlown date format: ${lastFlown}`);
    }

    const hasAcQlnFF = crew.validQualifications.some((qualObj:any) => qualObj.qualification.includes("FF"));
    const result = isCourse && ((lastFlown?.getTime() === new Date(duty.startUTC).getTime() && hasAcQlnFF) || lastFlown?.getTime() === BASELINE_DATE) || false;
    return result;
  } catch (error) {
    console.error("Error in tripIsInitialCourseDuty:", error);
    return false;
  }
}

/**
 * This function calculates the duty time for SKS contract crew based on specific conditions such as unpaid duty status, agreement validity, and crew qualifications.
 * @param activity - The whole activity Object.
 * @param crew - The whole crew Object.
 * @param duty - The whole duty Object.
 * @param referencedData - The whole referencedData Object.
 * @returns The calculated duty time in minutes.
*/
export async function dutyTimeSksCcTemp(activity: any, crew:any, duty: any, referencedData: any): Promise<number> {
  try {
    if(!activity || !crew || !duty || !referencedData) {
      throw new Error('Missing required parameters: activity, crew, duty, or referencedData');
    }

    if(!Array.isArray(referencedData.agreementValidity)) {
      throw new Error('Invalid referencedData: agreementValidity should be an array');
    }

    if(await unpaidDutySksCcTemp(crew, duty, referencedData)) {
      return 0;
    } else if(referencedData.agreementValidity.some((agreement: any) => agreement.id === 'salary_sks_cc_rp_home_sb')) {
      return await dutyTimeSksCcTempCalculation(crew, duty, activity, referencedData);
    } else {
      return await dutyTimeSksCc(crew, duty);
    }
  } catch (error) {
    console.error("Error in dutyTimeSksCcTemp:", error);
    return 0;
  }
}

/**
 * This Function checks if a duty qualifies as an unpaid duty for SKS contract crew based on specific conditions such as crew region, crew rank, crew contract type, and duty leg activities.
 * @param crew - The whole crew Object.
 * @param duty - The whole duty Object.
 * @param referencedData - The whole referencedData Object.
 * @returns A boolean indicating if the duty is an unpaid duty for SKS contract crew.
*/
export async function unpaidDutySksCcTemp(crew:any, duty: any, referencedData: any) {
  try {
    if(!crew || !duty || !referencedData) {
      throw new Error('Missing required parameters: crew, duty, or referencedData');
    }
  
    const isSKS:boolean = crewHasRegion(crew, "SKS");
    const isCabinCrew = await checkIsCabinCrew(crew);
    const isCrewTemporaryFlag: boolean = isCrewTemporary(crew, referencedData);
    const firstLeg = duty?.Leg[0];
    if(!firstLeg) return false;
  
    return (
      isSKS && 
      isCabinCrew && 
      isCrewTemporaryFlag && 
      (
        firstLeg.activity.includes('IL7') || 
        firstLeg.activity.includes('LA9') ||
        firstLeg.activity.includes('IL12') ||
        firstLeg.activity.includes('IL') ||
        duty.dutyCode.includes('LA42') ||
        duty.dutyCode.includes('FN') ||
        duty.Leg.some((leg: any) => leg.activity.includes('UF'))
      )
    );
  } catch (error) {
    console.error("Error in unpaidDutySksCcTemp:", error);
    return false;
  }
}

/**
 * This function calculates the duty time for SKS contract crew based on specific conditions such as standby callout status, home standby status, and whether the duty is a standby at home.
 * @param crew - The whole crew Object.
 * @param duty - The whole duty Object.
 * @param activity - The whole activity Object.
 * @param referencedData - The whole referencedData Object.
 * @returns The calculated duty time in seconds.
 */
export async function dutyTimeSksCcTempCalculation(crew: any, duty: any, activity: any, referencedData: any){
  try {
    const hasStandbyCalloutFlag         = await hasStandbyCallout(duty, activity?.Duty, activity);
    const dutyPeriodHasHomeStandbyFlag  = await dutyPeriodHasHomeStandby(duty, activity?.Duty, activity);
    const isStandByAtHomeFlag           = await isStandByAtHome(duty);
    const isHomeStandbyWithCallout      = hasStandbyCalloutFlag && dutyPeriodHasHomeStandbyFlag;
  
    if(isHomeStandbyWithCallout) {
      const sbySalaryHrsCalloutTime   = await sbySalaryHrsCallout(isHomeStandbyWithCallout, duty, activity?.Duty, activity);
      const activeDutyTimeCalloutTime = await activeDutyTimeCallout(isHomeStandbyWithCallout, duty, activity?.Duty, referencedData);
      
      if(sbySalaryHrsCalloutTime === null || activeDutyTimeCalloutTime === null) {
        return 0;
      }
      return sbySalaryHrsCalloutTime + activeDutyTimeCalloutTime;
    } else if(isStandByAtHomeFlag){
      return 6 * 60 * 60 * 1000; // 6 hours in milliseconds.
    } else {
      return await dutyTimeSksCc(crew, duty);
    }
  } catch (error) {
    console.log("Error in dutyTimeSksCcTempCalculation:", error);
    return 0;
  }
}

/**
 * This function calculates the active duty time for a duty that has home standby with callout status. It uses the duty period end time and the check-in start time to calculate the active duty time.
 * @param isHomeStandbyWithCallout - A boolean indicating if the duty has home standby with callout status.
 * @param duty - The whole duty Object.
 * @param dutyList - The list of duties in the duty period.
 * @param referencedData - The whole referencedData Object.
 * @returns The calculated active duty time in milliseconds, or null if the duty does not have home standby with callout status.
*/
export async function activeDutyTimeCallout(isHomeStandbyWithCallout: boolean, duty:any, dutyList: any, referencedData: any){
  try {
    if (!isHomeStandbyWithCallout) {
      return null; // void_reltime
    }
    const dutyPrdEndUtcTime         = new Date(duty.dutyPeriodEndUTC).getTime();
    const dutyPeriodCiStartUtcTime  = await dutyPeriodCiStartUtc(duty, dutyList, referencedData);
    if(dutyPeriodCiStartUtcTime === null || dutyPeriodCiStartUtcTime === undefined) {
      return null;
    }
    const ciStartMs = typeof dutyPeriodCiStartUtcTime === 'number'
      ? dutyPeriodCiStartUtcTime
      : new Date(dutyPeriodCiStartUtcTime).getTime();
  
    if (isNaN(ciStartMs)) {
      return null;
    }
    return dutyPrdEndUtcTime - ciStartMs;
  } catch (error) {
    console.log("Error in activeDutyTimeCallout:", error);
    return null;
  }
}

/**
 * This function calculates the check-in start time for a duty period, based on whether the current duty is the first duty in the duty period and if it has a check-in. It iterates through the legs of the relevant duty to find a leg with a check-in and returns the check-in start time in milliseconds. If no check-in is found, it returns null.
 * @param duty - The current duty object.
 * @param dutyChain - The list of duties in the duty period.
 * @param referencedData - The whole referencedData object.
 * @returns The check-in start time in milliseconds, or null if no check-in is found.
*/
export async function dutyPeriodCiStartUtc(duty: any, dutyChain: any, referencedData: any){
  try {
    const isFirstDuty = await isFirstDutyInDutyPeriod(duty, dutyChain);
    const dutyToCheck = isFirstDuty
    ? duty
    : getPrevDuty(dutyChain, dutyChain.findIndex((d: any) => d === duty));
    if(!dutyToCheck) {
      return null;
    }
  
    for (const leg of dutyToCheck?.Leg ?? []) {
      let hasCheckInFlag = await hasCheckin(duty, leg, referencedData);
      if(hasCheckInFlag) {
        const ciStart = await ciStartUTC(duty, leg, referencedData);
        return ciStart; // It is returning in ms.
      }
    }
    return null;
  } catch (error) {
    console.log("Error in dutyPeriodCiStartUtc:", error);
    return null;
  }
}

/**
 * This function calculates the standby salary hours for a duty that has home standby with callout status. It uses the standby callout UTC time and the duty start time to calculate the standby salary hours.
 * @param isHomeStandbyWithCallout - A boolean indicating if the duty has home standby with callout status.
 * @param duty - The whole duty Object.
 * @param dutyList - The list of duties in the duty period.
 * @returns - The calculated standby salary hours in milliseconds, or null if the duty does not have home standby with callout status.
*/
export async function sbySalaryHrsCallout(isHomeStandbyWithCallout: boolean, duty: any, dutyList: any, activity: any): Promise<number | null> {
  try {
    if(!duty || !dutyList) {
      throw new Error('Missing or invalid parameters: duty or dutyList');
    }

    const standbyReductionConst = 4;
    if (!isHomeStandbyWithCallout) {
      return null;
    }
    const standbyCalloutUtc = await standbyCalloutUTC(duty, dutyList, activity);
    if (standbyCalloutUtc === null) {
      return null;
    }
    const standbyCalloutUtcTimeStamp = new Date(standbyCalloutUtc).getTime();
    const diffMinutes = (standbyCalloutUtcTimeStamp - new Date(duty.startUTC).getTime()) / (60 * 1000);
    const roundedUpMinutes = Math.ceil(diffMinutes / 60) * 60;
    return (roundedUpMinutes / standbyReductionConst) * 60 * 1000; // Convert hours to milliseconds
  } catch (error) {
    console.log("Error in sbySalaryHrsCallout:", error);
    return null;
  }
}

/**
 * This function checks if a duty period has a home standby by determining if the current duty is the first duty in the duty period and then checking the legs of the relevant duty for a standby callout.
 * @param duty - The current duty object.
 * @param dutyChain - The list of duties in the duty period.
 * @returns A boolean indicating if the duty period has a home standby.
*/
export async function dutyPeriodHasHomeStandby(duty: any, dutyChain: any, activity: any): Promise<boolean> {
  try {
    if(!duty || !dutyChain || !Array.isArray(dutyChain)) {
      throw new Error('Missing or invalid parameters: duty or dutyChain');
    }

    const isFirstDuty = await isFirstDutyInDutyPeriod(duty, dutyChain);
    const dutyToCheck = isFirstDuty
    ? duty
    : getPrevDuty(dutyChain, dutyChain.findIndex((d: any) => d === duty));
    if(!dutyToCheck) {
      throw new Error('Duty to check for home standby not found');
    }

    const firstLeg = dutyToCheck?.Leg && dutyToCheck.Leg.length > 0 ? dutyToCheck.Leg[0] : null;
    if(!firstLeg) {
      throw new Error('No legs found in duty to check for home standby');
    }

    const isStandByCalloutFirstLeg = await isStandbyCallout(firstLeg, dutyToCheck, activity);
    if(isStandByCalloutFirstLeg) {
      return true;
    }
    return false;
  } catch (error) {
    console.log("Error in dutyPeriodHasHomeStandby:", error);
    return false;
  }
}

/**
 * This function calculates the duty time for SKS contract crew based on specific conditions such as actual end time, scheduled end time, and check-out scheduled time. It compares the actual end time with the scheduled end time and returns the appropriate duty time in milliseconds.
 * @param crew - The whole crew Object.
 * @param duty - The whole duty Object.
 * @returns The calculated duty time in milliseconds.
*/
export async function dutyTimeSksCc(crew: any, duty:any) {
  try {
    const lastLeg  = duty.Leg[duty.Leg.length - 1];
    const startUTC = duty.dutyPeriodStartUTC;
    const endUTC   = duty.dutyPeriodEndUTC;
    const time     = new Date(endUTC).getTime() - new Date(startUTC).getTime();
  
    const actualEndTimeUtc    = new Date(lastLeg.legEndUTC).getTime();
    const scheduledEndTimeUtc = new Date(lastLeg.scheduledEndTimeUTC).getTime();
  
    const checkOutScheduledTimeSeconds = await getCheckOutScheduledMinutes(crew, duty, lastLeg) * 60;
    const endScheduledUtc              = scheduledEndTimeUtc + (checkOutScheduledTimeSeconds * 1000);
    const scheculedTime                = endScheduledUtc - new Date(startUTC).getTime();
  
    if(actualEndTimeUtc < scheduledEndTimeUtc && time < scheculedTime) {
      return scheculedTime
    } else {
      return time;
    }
  } catch (error) {
    console.log("Error in dutyTimeSksCc:", error);
    return 0;
  }
}

/**
 * This function calculates the check-out scheduled minutes for a given crew, duty, and leg.
 * It considers default check-out times and any exceptions based on training or other conditions.
 * @param crew - The whole crew Object.
 * @param duty - The whole duty Object.
 * @param leg - The specific leg Object.
 * @returns The calculated check-out scheduled minutes.
 */
export async function getCheckOutScheduledMinutes(crew: any, duty: any, leg: any) {
  try {
    if(!leg) throw new Error("leg is required for checkOutScheduled");
    const DEFAULT_MINS = 60;
    const defaultTime   = leg.checkOutDefault ? leg.checkOutDefault : null;
    const exceptionTime = checkOutTrainingExcep(crew, duty, leg);
  
    // Apply default only if both values are void.
    if (defaultTime == null && exceptionTime == null) {
      return DEFAULT_MINS;
    }
  
    const defaultMins   = defaultTime   != null ? await convertTimeToMinutes(defaultTime)   : 0;
    const exceptionMins = exceptionTime != null ? await convertTimeToMinutes(exceptionTime) : 0;
    return defaultMins + exceptionMins;
  } catch (error) {
    console.log("Error in getCheckOutScheduledMinutes:", error);
    return 0;
  }
}

/**
 * This function checks for any training exceptions that may apply to the check-out scheduled time for a given crew, duty, and leg. It verifies if the leg has a check-out training exception and if it matches the crew and duty IDs. If an exception is found, it returns the exception time; otherwise, it returns null.
 * @param crew - The whole crew Object.
 * @param duty - The whole duty Object.
 * @param leg - The specific leg Object.
 * @returns The training exception time or null if no exception is found.
*/
export function checkOutTrainingExcep(crew: any, duty: any, leg: any) {
  try {
    if(!leg || !leg.checkOutTrainingException) return null;

    if(duty.id !== leg.dutyId || crew.crewId !== leg.crewId) return null;

    const trainingException = leg.checkOutTrainingException;
    return trainingException;
  } catch (error) {
    console.log("Error in checkOutTrainingExcep: ", error);
    return null;
  }
}

/** Feature File Code Ends  */


/** Develop Branch Code Starts */
import { FDagreementGroupSet } from './constant';
import { crewContractOnDate, crewEmploymentOnDate, isPaycodePresent } from './crew-util';
import { generatePayCode, getRankFromDate, reportRecords } from './time-entry-util';
import { simulatorSet } from './constant';
import { isONDuty, isSchoolFlight } from './crew-util';
import {
  getActivityMasterData,
  getAllBoughtDays,
  getAllPrivatelyTradedDays,
  getAllCrewRosterAttr,
  getActivityGroupPeriodData,
} from '../repository/time-entry/time-entry-repository';
import {isHomeStandbyWithCallout, getFirstLegWithCheckInCiStartUTC, sbySalaryHrsCallout, activeDutyTimeCallout, durationToMinutes, isBlankDay } from './standby-util';
import { lowerLimitHours, splitDutyRestSalaryReductionCont, lowerLimitHoursPerDPNKFSNKCCTempCrew } from './constant';
import { dutyTimeAcclimPeriod } from './duty-acclim-util';
import { outStationLongRestPeriodDutyHrs } from './leg-util';
import { isExceptionSZSSKNO, isCrewTemporaryOnDate, isNKFSNKOnDate } from './crew-util';
import { isCabinCrew } from './duty-overtime-util';



interface CrewRosterAttrRecord {
  attr: string;
  validFrom: string | Date;
  validTo: string | Date;
}

export const activityMasterData = await getActivityMasterData();

export const activityGroupPeriodData = await getActivityGroupPeriodData();

// Set of valid school period codes
export const validSchoolPeriodCodes = new Set(['CS', 'CS8', 'FT1', 'TH1', 'SI1', 'F20', 'BL20', 'B']);
// Set of valid school period group codes
export const validSchoolPeriodGroupCodes = new Set(['SIB']);

// this function will generate paycode for the duty's first leg if its satisfies the given condition

export async function dutyFilter(crew: any, referencedData: any) {
    let flag = false;
    let code;
    const trip = crew.Trip;
    let isActual:boolean = true; // flag to check whether ro use actual rank or not

  // Loop through each trip
  for (let i = 0; i < trip.length; i++) {
    const allDuty = trip[i].Duty;

    // Loop through each duty in the trip
    for (let j = 0; j < allDuty.length; j++) {
      // Safety check for duty and leg access
      if (!allDuty[j] || !Array.isArray(allDuty[j].Leg) || allDuty[j].Leg.length === 0) {
        console.error(`Invalid duty object or empty Leg array at trip ${i}, duty ${j} in duty-util.ts`);
        continue;
      }

      const currLeg = allDuty[j].Leg[0];
      const crewId = crew.crewId;
      const txnDate = currLeg?.scheduledTimeStart;

      try {
        // Fetch contract for the transaction date
        if (currLeg == undefined) {
          return null;
        }

        const contractOnDate = crewContractOnDate(referencedData.crewContract[crewId], txnDate);
        const contract = contractOnDate?.contract;
        const agreementgroup = referencedData.contractMaster[contract]?.agmtGroup;

        // Fetch rank data for the transaction date
        const rankData = await getRankFromDate(crew, txnDate);

        // Fetch employment data for the transaction date
        const employmentOnDate = crewEmploymentOnDate(referencedData.crewEmployment[crewId], txnDate);
        const country = employmentOnDate?.country;

        flag = false;

          // Check the conditions for generating Paycode
          if (currLeg.activityCode === 'PR' && FDagreementGroupSet.has(agreementgroup) && rankData === 'FC') {
            code = 'PR';
            flag = true;
            isActual = false; // setting flag to false for using non actual rank
          }

          if (flag === true) {
            const paycode = generatePayCode(code, '', crewId, country, rankData,isActual);

          // If Paycode is Null, skip this iteration
          if (paycode === null) {
            continue;
          }

          try {
            // Check if generated paycode is already present in wfsCorrectedData
            const isPaycodePresentFlag = await isPaycodePresent(
              crewId,
              paycode,
              referencedData.wfsCorrectedData,
              txnDate
            );

            if (!isPaycodePresentFlag) {
              currLeg.extPerKey = employmentOnDate.employmentId;
              currLeg.wfsPayCode = paycode;
              currLeg.workDay = currLeg?.scheduledTimeStart;
              currLeg.daysOff = 1;

              // Report records if paycode is not present
              try {
                const records = await reportRecords([currLeg]);
              } catch (err) {
                console.error(`Error reporting records for crewId ${crewId} on ${txnDate}:`, err);
              }
            }
          } catch (err) {
            console.error(`Error checking paycode presence for crewId ${crewId} on ${txnDate}:`, err);
          }
        }
      } catch (err) {
        console.error(`Error processing leg for crewId ${crewId} on ${txnDate}:`, err);
      }
    }
  }
}

/**
 * 
 * @param leg 
 * @returns 
 * Checks leg activity code.
 */
export async function isSimulator(leg: any) {
  try {
    const legActivityCode = leg.activityCode;

    // Check if the leg activity code is in the simulator set
    if (simulatorSet.has(legActivityCode)) {
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error checking isSimulator:', error);
    return false;
  }
}

/**
 * Determines if a flight leg is active.
 * @param leg - The flight leg object.
 * @returns A promise that resolves to true if the flight leg is active, otherwise false.
 */
export async function isActiveFlight(leg: any) {
  try {
    if (leg.activityCode === 'FLT' && leg.isActiveFlight) {
      // if active flight is True then the flight is not deadhead
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error('Error in func isActiveFlight:', error);
  }
}

/**
 * Checks if a duty has any active flights
 * @param duty - The duty object
 * @returns True if any leg in the duty is an active flight, false otherwise
 */
export async function hasActiveFlight(duty: any): Promise<boolean> {
  try {
    // Check if duty.Leg is defined and is an array
    if (!duty || !Array.isArray(duty.Leg)) {
      console.error('Invalid duty object or duty.Leg is not an array in hasActiveFlight');
      return false;
    }

    // Check if any leg is an active flight (FLT activity with isActiveFlight = true)
    return duty.Leg.some((leg: any) => leg.activityCode === 'FLT' && leg.isActiveFlight === true);
  } catch (error) {
    console.error('Error in hasActiveFlight function:', error);
    return false;
  }
}

export async function getGroupActivityMasterById(activitycode: string) {
  try {
    // Find the activity with id === activitycode
    const found = Array.isArray(activityMasterData)
      ? activityMasterData.find((activity: any) => activity.id === activitycode)
      : null;
    if (found) {
      return found.group;
    }
    return undefined;
  } catch (error) {
    console.error('Error in getGroupActivityMasterById:', error);
    throw error;
  }
}

/**
 * Enum representing different duty calculation types.
 * This enum is used to categorize the type of duty calculation for crew members.
 * It includes types like union, overtime, CAA (Crew Activity Allowance), net SKJ, and union scheduled.
 */
export enum DutyCalculation {
  union = 'union',
  overtime = 'overtime',
  caa = 'caa',
  net_skj = 'net_skj',
  union_scheduled = 'union_scheduled', // like union, but used scheduled c/o in tracking
}

// Helper functions for DutyCalculation type checks
export function isSalary(dutycalc: DutyCalculation): boolean {
  return dutycalc === DutyCalculation.overtime;
}

export function isNetSkj(dutycalc: DutyCalculation): boolean {
  return dutycalc === DutyCalculation.net_skj;
}

export function isUnionScheduled(dutycalc: DutyCalculation): boolean {
  return dutycalc === DutyCalculation.union_scheduled;
}

/**
 * Checks if a leg is simulator.
 * @param leg - The leg object
 * @returns True if the leg's group(activity) is 'PGT'
 */
export async function isPgt(leg: any) {
  const group = await getGroupActivityMasterById(leg.activityCode);
  return group === 'PGT';
}

/**
 * Checks if a leg is EMG-PGT.
 * @param leg - The leg object
 * @returns True if the leg's group(activity) is 'EMG-PGT'
 */
export async function isEmgPgt(leg: any) {
  const group = await getGroupActivityMasterById(leg.activityCode);
  return group === 'EMG-PGT';
}

/**
 *
 * @param duty
 * @returns
 * True if all legs have group 'SBY'
 */
export async function isStandBy(duty: any) {
  if (!duty.Leg || !Array.isArray(duty.Leg) || duty.Leg.length === 0) return false;
  for (const leg of duty.Leg) {
    const group = await getGroupActivityMasterById(leg.activityCode);
    if (group !== 'SBY') return false;
  }
  return true;
}

/**
 * Checks if a leg is standby line (group === 'SBL')
 * @param leg - The leg object
 * @returns True if leg has group 'SBL'
 */
export async function isStandbyLineLeg(leg: any): Promise<boolean> {
  try {
    const group = await getGroupActivityMasterById(leg.activityCode);
    return group === 'SBL';
  } catch (error) {
    console.error('Error in isStandbyLineLeg:', error);
    return false;
  }
}

/**
 * Checks if a duty is standby line
 * @param duty - The duty object
 * @returns True if duty is standby AND first leg is standby line
 */
export async function isStandbyLine(duty: any): Promise<boolean> {
  try {
    // Check if duty is standby
    const isStandbyDuty = await isStandBy(duty);
    if (!isStandbyDuty) {
      return false;
    }

    // Check if duty has legs and get the first leg
    if (!duty.Leg || !Array.isArray(duty.Leg) || duty.Leg.length === 0) {
      return false;
    }

    const firstLeg = duty.Leg[0];

    // Check if first leg is standby line
    return await isStandbyLineLeg(firstLeg);
  } catch (error) {
    console.error('Error in isStandbyLine:', error);
    return false;
  }
}

/**
 * Checks if a duty is standby at home (group === 'SBH')
 * @param duty - The duty object
 * @returns True if all legs have group 'SBH'
 */

export async function isStandByAtHome(duty: any) {
  if (!duty.Leg || !Array.isArray(duty.Leg) || duty.Leg.length === 0) return false;
  for (const leg of duty.Leg) {
    const group = await getGroupActivityMasterById(leg.activityCode);
    if (group !== 'SBH') return false;
  }
  return true;
}

/**
 * Checks if a duty is standby at a hotel (group === 'SBO')
 * @param duty - The duty object
 * @returns True if all legs have group 'SBO'
 */

export async function isStandByAtHotel(duty: any) {
  if (!duty.Leg || !Array.isArray(duty.Leg) || duty.Leg.length === 0) return false;
  for (const leg of duty.Leg) {
    const group = await getGroupActivityMasterById(leg.activityCode);
    if (group !== 'SBO') return false;
  }
  return true;
}

/**
 * Checks if all legs in duty are standby at airport (group === 'SBA') using getGroupActivityMasterById
 * @param duty - The duty object
 * @returns True if all legs have group 'SBA'
 */
export async function isStandByAtAirport(duty: any) {
  if (!duty.Leg || !Array.isArray(duty.Leg) || duty.Leg.length === 0) return false;
  for (const leg of duty.Leg) {
    const group = await getGroupActivityMasterById(leg.activityCode);
    if (group !== 'SBA') return false;
  }
  return true;
}

/**
 *
 * @param duty
 * @returns
 * This function checks if a duty is privately traded by looking for a record in the crewRosterAttr
 * array that matches the 'PRIVATELYTRADED' attribute and falls within the validFrom and validTo dates.
 * It returns true if a matching record is found, otherwise false.
 */
export async function isPrivatelyTraded(duty: any) {
  if (!duty || !duty.crewId || !duty.startUTC) return false;

  // Filter attributes for this crewId
  const crewRosterAttrList = await getAllCrewRosterAttr();
  const filterCrewRosterAttrByCrewId = crewRosterAttrList.filter((attr: any) => attr.crewId === duty.crewId);

  // Check if any record matches the PRIVATELYTRADED condition
  return filterCrewRosterAttrByCrewId.some((record: CrewRosterAttrRecord) => {
    if (record.attr !== 'PRIVATELYTRADED') return false;
    const dutyStart = new Date(duty.startUTC).getTime();
    const validFrom = new Date(record.validFrom).getTime();
    const validTo = new Date(record.validTo).getTime();
    return dutyStart >= validFrom && dutyStart <= validTo;
  });
}

/**
 *
 * @param duty
 * @param reportStartDate
 * @param reportEndDate
 * @returns
 * This function checks if the duty is within the specified report period by comparing the duty's start
 * and end times with the report start and end dates. It returns true if the duty is within the period,
 * otherwise false.
 */
export function dutyInPeriod(duty: any, reportStartDate: string, reportEndDate: string) {
  try {
    const dutyStart = new Date(duty.startUTC);
    const dutyEnd = new Date(duty.endUTC);
    const startDate = new Date(reportStartDate);
    const endDate = new Date(reportEndDate);

    // Check if the duty start and end times are within the report period
    return dutyStart >= startDate && dutyEnd <= endDate;
  } catch (error) {
    console.error('Error checking if duty is in period:', error);
    return false;
  }
}

/**
 *
 * @param startHomeBase
 * @param crewBoughtdays
 * @returns
 * This function checks if a duty is bought by comparing the start time of the duty with the
 * start and end times of the crew's bought days.
 * It returns true if the duty is bought, otherwise false.
 */
export async function isBought(startHomeBase: any, crewBoughtdays: any) {
  try {
    // Convert the startHomeBase into a Date object
    const dutyStartTime = new Date(startHomeBase);

    for (const boughtDay of crewBoughtdays) {
      const startTime = new Date(boughtDay.startTime);
      const endTime = new Date(boughtDay.endTime);

      // Check if the duty start time is between the bought day start and end times
      if (dutyStartTime >= startTime && dutyStartTime <= endTime) {
        return true;
      }
    }

    // If no matching bought day is found
    return false;
  } catch (error) {
    console.error('Error checking if duty is bought:', error);
    return false;
  }
}

/**
 *
 * @param startUTC
 * @param privatelyTradedDays
 * @param crewId
 * @returns
 * This function calculates the privately traded duty overtime for a given crew member based on the
 * start time of the duty and the privately traded days data.
 */
export async function ptdDutyOvertime(startUTC: any, privatelyTradedDays: any, crewId: string) {
  try {
    const dutyStartUTC = new Date(startUTC);
    const crewPrivatelyTradedDays = await filterPTDOverTimeByCrewId(crewId, privatelyTradedDays);

    for (const tradeDay of crewPrivatelyTradedDays) {
      const tradeDutyStart = new Date(tradeDay.dutyStart);
      const tradeDutyEnd = new Date(tradeDay.dutyEnd);

      // Check if the duty start time is between the trade day start and end times and return duty overtime
      if (dutyStartUTC >= tradeDutyStart && dutyStartUTC <= tradeDutyEnd) {
        return tradeDay.dutyOvertime;
      }
    }
    // If no matching trade day is found, return 0
    return 0;
  } catch (error) {
    console.error('Error calculating PTD duty overtime:', error);
    return 0;
  }
}

/**
 *
 * @param crewId
 * @param privatelyTradedDays
 * @returns
 * This function filters the privately traded days data based on the crewId and returns only
 * those records that match the crewId and have a dutyOvertimeType of 'OT_PART_7_CALENDAR_DAYS'.
 */

export async function filterPTDOverTimeByCrewId(crewId: string, privatelyTradedDays: any) {
  try {
    const filteredPrivatelyTradedDays = privatelyTradedDays.filter(
      (item: { crewId: string; dutyOvertimeType: string }) =>
        item.crewId === crewId && item.dutyOvertimeType == 'OT_PART_7_CALENDAR_DAYS'
    );

    return filteredPrivatelyTradedDays;
  } catch (error) {
    console.error('Error filtering privately traded days:', error);
    return [];
  }
}

/**
 *
 * @param duty
 * @param privatelyTradedDays
 * @returns
 * This function calculates the end time of a duty in UTC and rounds it up to the nearest 24:00 hours.
 * It then applies the home base time zone correction and returns the adjusted end time.
 */

export async function ptdDutyEnd(duty: any) {
  try {
    const dutyStartHomebase = new Date(duty.startHomeBase);
    const dutyEndHomebase = new Date(duty.endHomeBase);

    // Filter Privately Traded Days for this crewId
    const filterPrivatelyTradedDaysByCrewId = (await getAllPrivatelyTradedDays()).filter((day: any) => day.crewId === duty.crewId);

    for (const tradeDay of filterPrivatelyTradedDaysByCrewId) {
      const tradePeriodStart = new Date(tradeDay.periodStart);
      const tradePeriodEnd = new Date(tradeDay.periodEnd);

      // Check if the duty start time is between the trade day start and end times and return duty overtime
      if (dutyStartHomebase >= tradePeriodStart && dutyEndHomebase <= tradePeriodEnd) {
        return tradeDay.dutyEnd;
      }
    }
  } catch (error) {
    console.error('Error getting ptdDutyEnd:', error);
    return 0;
  }
}

/**
 * @param duty
 * @returns
 * This function checks if the duty is a flight duty by looking for an active flight in the duty's legs.
 * It returns true if there is an active flight, otherwise false.
 */

export async function isFlightDuty(duty: any) {
  try {
    if (!duty || !Array.isArray(duty.Leg)) {
      console.error('Invalid duty object or duty.Leg is not an array');
      return false;
    }

    let isActiveFlight = duty.Leg.some((leg: any) => leg.activityCode === 'FLT' && leg.isActiveFlight);

    return isActiveFlight;
  } catch (error) {
    console.error('Error checking in isFlightDuty:', error);
    return false;
  }
}

/**
 *
 * @param task
 * @param duty
 * @param activityMasterDataParam - Optional activity master data to avoid repeated fetches
 * @param activityGroupPeriodDataParam - Optional activity group period data to avoid repeated fetches
 * @returns
 * This function checks if the task is a ground duty by verifying if the duty is a flight duty and
 * if the task is on duty.
 */
export async function isGroundDuty(task?: any, duty?: any, activityMasterDataParam?: any, activityGroupPeriodDataParam?: any): Promise<boolean> {
  try {
    // If duty is provided and is not a flight duty, check the task conditions
    if (duty) {
      if ((await isFlightDuty(duty)) === false) {
        return false;
      }
    }

    // If task is provided, check activity type using activityMaster and activityGroupPeriod
    if (task && task.activityType) {
      const group = await getGroupActivityMasterById(task.activityType);
      
      if (group) {
        const agpData = activityGroupPeriodDataParam ?? activityGroupPeriodData;
        const filterAGPData = agpData.find((agp: any) => agp.id === group);
        
        // Check if onDuty is true from activityGroupPeriod and activity type is not 'PR'
        if (filterAGPData && filterAGPData.onDuty && task.activityType !== 'PR') {
          return true;
        }
      }
    }
    return false;
  } catch (error) {
    console.error('Error checking if duty is a ground duty:', error);
    return false;
  }
}

/**
 *
 * @param astart
 * @param aend
 * @param bstart
 * @param bend
 * @returns
 * This function calculates the overlap in minutes between two time intervals.
 * It takes the start and end times of both intervals as input and returns the overlap duration in minutes.
 */

export function overlap(astart: string, aend: string, bstart: string, bend: string): number {
  const aStart = new Date(astart);
  const aEnd = new Date(aend);
  const bStart = new Date(bstart);
  const bEnd = new Date(bend);

  const overlapStart = aStart > bStart ? aStart : bStart;
  const overlapEnd = aEnd < bEnd ? aEnd : bEnd;

  if (overlapStart >= overlapEnd) {
    return 0;
  }

  const overlapMs = overlapEnd.getTime() - overlapStart.getTime();
  const overlapMinutes = overlapMs / (1000 * 60);

  //console.log(`Overlap Minutes: ${overlapMinutes}`);

  return overlapMinutes;
}

/**
 *
 * @param duty
 * @returns
 * This function checks if the duty is a deadhead flight by looking for a leg with activity code 'FLT'
 * and checking if the flight is not active. It returns true if it is a deadhead flight, otherwise false.
 */
export async function IsDeadHead(duty: any) {
  try {
    let isDead: boolean = false;
    duty.Leg.some((leg: any) => {
      if (leg.activityCode == 'FLT' && leg.isActiveFlight == false) {
        isDead = true;
        return true;
      }
    });

    return isDead;
  } catch (error) {
    console.error('Error in IsDeadHead function:', error);
    throw error;
  }
}

/**
 * Checks if a duty has any deadhead flights
 * @param duty - The duty object
 * @returns True if any leg in the duty is a deadhead flight, false otherwise
 */
export async function hasDeadhead(duty: any): Promise<boolean> {
  try {
    // Check if duty.Leg is defined and is an array
    if (!duty || !Array.isArray(duty.Leg)) {
      console.error('Invalid duty object or duty.Leg is not an array in hasDeadhead');
      return false;
    }

    // Check if any leg is a deadhead flight (FLT activity with isActiveFlight = false)
    return duty.Leg.some((leg: any) => leg.activityCode === 'FLT' && leg.isActiveFlight === false);
  } catch (error) {
    console.error('Error in hasDeadhead function:', error);
    return false;
  }
}

/**
 * Checks if a duty has standby manual duty break (based on last leg)
 * @param duty - The duty object
 * @param referencedData - Referenced data for attributes
 * @returns True if the last leg in the duty is standby manual duty break, false otherwise
 */
export async function isSbyManualDutyBreak(duty: any): Promise<boolean> {
  try {
    // Check if duty.Leg is defined and is an array
    if (!duty || !Array.isArray(duty.Leg) || duty.Leg.length === 0) {
      return false;
    }

    // Get the last leg of the duty
    const lastLeg = duty.Leg[duty.Leg.length - 1];

    // Check if the last leg is standby at airport AND has duty break attribute
    const isStandbyAtAirport = await isStandByAtAirport(duty);
    const hasDutyBreakAttribute = await legHasDutyBreakAttribute(lastLeg);

    return isStandbyAtAirport && hasDutyBreakAttribute;
  } catch (error) {
    console.error('Error in isSbyManualDutyBreak:', error);
    return false;
  }
}

/**
 * Gets the rest time after the duty
 * @param duty - The duty object
 * @returns Rest time string or null
 */
export async function getDutyRestTime(duty: any): Promise<string | null> {
  try {
    // Placeholder implementation - you'll need to replace this with actual logic
    return duty.restTime || duty.restTimeAfter || null;
  } catch (error) {
    console.error('Error in getDutyRestTime:', error);
    return null;
  }
}

/**
 * Gets the rest time before the duty
 * @param duty - The duty object
 * @returns Rest time string or null
 */
export async function getDutyRestTimeBeforeDuty(duty: any): Promise<string | null> {
  try {
    // Placeholder implementation - you'll need to replace this with actual logic
    return duty.restTimeBefore || duty.restTimeBeforeDuty || null;
  } catch (error) {
    console.error('Error in getDutyRestTimeBeforeDuty:', error);
    return null;
  }
}

/**
 * Gets the next duty in the chain
 * @param dutyChain - Array of duties
 * @param currentIndex - Current duty index
 * @returns Next duty or null
 */
export function getNextDuty(dutyChain?: any[], currentIndex?: number): any | null {
  if (!dutyChain || currentIndex === undefined || currentIndex >= dutyChain.length - 1) {
    return null;
  }
  return dutyChain[currentIndex + 1];
}

/**
 * Gets the previous duty in the chain
 * @param dutyChain - Array of duties
 * @param currentIndex - Current duty index
 * @returns Previous duty or null
 */
export function getPrevDuty(dutyChain?: any[], currentIndex?: number): any | null {
  if (!dutyChain || currentIndex === undefined || currentIndex <= 0) {
    return null;
  }
  return dutyChain[currentIndex - 1];
}

// Method to check if the activity is a meeting by checking if the activity code is 'MET'
export async function isMeeting(activity: any, type: any) {
  try {
    const activityData = activityMasterData;
    let activityCode = type === 'task' ? activity?.activityType : activity.dutyCode;
    // Find the activity with id === activityCode
    const found = Array.isArray(activityData)
      ? activityData.find((item: any) => item.id === activityCode)
      : null;
    const group = found?.group;
    //console.log('activityCode-------',activityCode,'found-------',found,'group-------',group);
    const isMET = group === 'MET';
    //console.log('isMeeting------------','activity-----------',activity.dateOfOperation, 'type------------',type, activityCode, 'group-------', group, 'isMET-------', isMET);
    return isMET;
  } catch (error) {
    console.error('Error in isMeeting function:', error);
    throw new Error('Error in isMeeting function');
  }
}

/**
 * Checks if a duty is a valid school activity for overtime exclusion.
 * @param duty - The duty object
 * @param activityMasterData - Optional activity master data to avoid repeated fetches
 * @returns True if the duty is a valid school activity, false otherwise
 */

export async function dutyIsValidSchoolActivity(duty: any) {
  if (!duty || !Array.isArray(duty.Leg) || !has_restr_training_leg_start()) return false;

  const activityData = activityMasterData;

  for (const leg of duty.Leg) {
    const isFlightActive = leg.activityCode;
    const flightCarrier = leg.carrier;
    const getflightNr = leg.activity;
    const parts = getflightNr.split(' ');
    let flightNr = '';
    // Check if there are at least two parts
    if (parts.length > 1) {
      // Return the second part
      flightNr = parts[1];
    }

    if (await isSimulator(leg)) return true;

    if (await isPgt(leg)) return true;

    if (await isEmgPgt(leg)) return true;

    if (await isSchoolFlight(flightCarrier, flightNr)) return true;

    // IsDeadHead: async helper, expects duty, so wrap leg in a dummy duty
    if (await IsDeadHead({ Leg: [leg] })) return true;

    // code in validSchoolPeriodCodes
    if (leg.code && validSchoolPeriodCodes.has(leg.code)) return true;

    // group_code in validSchoolPeriodGroupCodes
    if (leg.group_code && validSchoolPeriodGroupCodes.has(leg.group_code)) return true;
  }
  return false;
}

function has_restr_training_leg_start() {
  // placeholder method , ayan will discuss with priyanka regarding this.
  return true;
}

/**
 * Checks if a duty is not valid for overtime based on meeting and hasActiveFlight rules.
 *
 * @param duty - The duty object
 * @param activityMasterData - Optional activity master data to avoid repeated fetches
 * @returns True if the duty is not valid for overtime, false otherwise
 */
export async function dutyIsNotValidOvertime(duty: any, activityMasterData?: any): Promise<boolean> {
  const activityData = activityMasterData;
  const notValidOT = await isMeeting(duty, 'duty') && !(await hasActiveFlight(duty)) || (await dutyIsValidSchoolActivity(duty));
  return notValidOT;
}

/**
 * Calculates the rest time before a duty in HH:mm format
 * @param duty - The current duty object
 * @param prevDuty - The previous duty object (can be null)
 * @returns Rest time before duty as a string in 'HH:mm' format
 */
export async function restTimeBeforeDuty(duty: any, prevDuty: any): Promise<string> {
  // Get start and end of rest period
  const restStart = await restStartBeforeDuty(duty, prevDuty);
  const restEnd = restEndBeforeDuty(duty);

  // Convert to Date objects
  const startDate = new Date(restStart);
  const endDate = new Date(restEnd);
  // Calculate difference in minutes
  let diffMs = endDate.getTime() - startDate.getTime();
  if (diffMs < 0) diffMs = 0;
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export async function restStartBeforeDuty(duty: any, prevDuty: any) {
  if (prevDuty && ! await restDuty(prevDuty)) {
    // Format prevDuty.endUTC as 'YYYY-MM-DD HH:mm'
    const end = new Date(prevDuty.endUTC);
    const year = end.getFullYear();
    const month = String(end.getMonth() + 1).padStart(2, '0');
    const day = String(end.getDate()).padStart(2, '0');
    const hours = String(end.getHours()).padStart(2, '0');
    const minutes = String(end.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } else {
    // Subtract 900 minutes (15 hours) from duty.startUTC and format as 'YYYY-MM-DD HH:mm'
    const start = new Date(duty.startUTC);
    const minus900 = new Date(start.getTime() - 900 * 60 * 1000);
    // Format as 'YYYY-MM-DD HH:mm'
    const year = minus900.getFullYear();
    const month = String(minus900.getMonth() + 1).padStart(2, '0');
    const day = String(minus900.getDate()).padStart(2, '0');
    const hours = String(minus900.getHours()).padStart(2, '0');
    const minutes = String(minus900.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }
}

export function restEndBeforeDuty(duty: any) {
  return duty.startUTC;
}

// rest time is same as restTime after duty
export async function restTime(duty: any, nextDuty: any) {

  //console.log('Calculating rest time for current duty:', duty, 'nextDuty:', nextDuty);

  const restStart = restStartAfterDuty(duty);
  //console.log('duty---------:', duty.dateOfOperation);
  //console.log('Rest start time:', restStart);

  const restEnd = await restEndAfterDuty(duty, nextDuty);
  //console.log('Rest end time:', restEnd);

  // Convert to Date objects
  const startDate = new Date(restStart);
  const endDate = new Date(restEnd);
  
  // Calculate difference in milliseconds
  let diffMs = endDate.getTime() - startDate.getTime();
  //console.log('Difference in milliseconds:', diffMs);
  
  if (diffMs < 0) diffMs = 0;
  
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  
  return `${hours}:${minutes}`;
}

export async function restEndAfterDuty(duty: any, nextDuty: any) {
  // console.log('duty startutc---------.', duty.startUTC);
  // console.log('nextDuty startutc 1---------.', nextDuty ? nextDuty.startUTC : 'null');

  // console.log('nextDuty---------.', nextDuty);
  // console.log('restDuty(nextDuty)---------.', await restDuty(nextDuty));

  if (nextDuty && !await restDuty(nextDuty)) {
    // console.log('nextDuty startutc 2---------.', nextDuty.startUTC);
    return nextDuty.startUTC;
  } else {
    return duty.startUTC;
  }
}

export function restStartAfterDuty(duty: any) {
  return duty.endUTC;
}

export async function restDuty(duty: any) {
  // Check if duty is null or undefined
  if (!duty) {
    return false;
  }

  if (duty.dutyCode && duty.dutyCode === "W") {
    return false;
  }

  // Guard for undefined global
  if (typeof activityMasterData === 'undefined' || !Array.isArray(activityMasterData)) {
    return false;
  }

  const activityMaster = activityMasterData.find((am: any) => am.id === duty.dutyCode);
  //console.log('duty-------', duty.dateOfOperation);
  //console.log('restDuty dutyCode-------', duty.dutyCode);
  ///console.log('restDuty activityMaster-------', activityMaster);
  
  if (activityMaster && activityMaster.group && typeof activityGroupPeriodData !== 'undefined' && Array.isArray(activityGroupPeriodData)) {
    const group = activityMaster.group;
    //console.log('restDuty group-------', group);
    const filterAGPData = activityGroupPeriodData.find((agp: any) => agp.id === group);
    //console.log('restDuty filterAGPData-------', filterAGPData);
    return filterAGPData ? filterAGPData.dayOff : false;
  }

  return false;
}


/**
 *
 * @param leg
 * @returns
 *
 */
export async function isStandByAtAirportInLeg(leg: any) {
  if (!leg || !leg.activityCode) return false;
  const group = await getGroupActivityMasterById(leg.activityCode);
  return group === 'SBA';
}

/**
 * Checks if a leg has the duty break attribute.
 * @param leg - The leg object to check.
 * @returns True if the leg has the duty break attribute, false otherwise.
 */
export function legHasDutyBreakAttribute(leg: any) {
  if (leg?.attribute?.flightDutyAttr == 'DUTY_BREAK') {
    return true;
  }
  return false;
}

/**
 * Returns the start UTC for a duty period, using the previous duty's start UTC if not first in period.
 * Implements:
 *   if not is_first_duty_in_duty_period then prev(duty(chain), duty.start_utc) else duty.start_utc
 * @param duty The current duty object
 * @param dutyChain The array of duties (duty period)
 * @returns {Promise<string>} The start UTC string
 */
// export async function startUTCInDutyPeriod(duty: any, dutyChain: any[]): Promise<string> {
//   try {
//     const currentDutyIndex = dutyChain.findIndex((d: any) => d === duty);
//     console.log('Current Duty Index:', currentDutyIndex);
//     if (currentDutyIndex === -1) {
//       console.error('Current duty not found in duty chain');
//       return duty?.startUTC || '';
//     }
//     const isFirst = await isFirstDutyInDutyPeriod(duty, dutyChain);
//     console.log('Current Duty Index:', currentDutyIndex);
//     if (!isFirst && currentDutyIndex > 0) {
//       const prevDuty = dutyChain[currentDutyIndex - 1];
//       return prevDuty?.startUTC || duty?.startUTC || '';
//     } else {
//       return duty?.startUTC || '';
//     }
//   } catch (error) {
//     console.error('Error in start_utc:', error);
//     return duty?.startUTC || '';
//   }
// }

/**
 * Checks if the given duty is the first duty in a duty period.
 * Implements: default(prev(duty(wop), is_last_duty_in_duty_period), true)
 * @param duty The current duty object
 * @param dutyChain The array of duties (duty period)
 * @returns {Promise<boolean>} True if first in duty period, else false
 */
export async function isFirstDutyInDutyPeriod(duty: any, dutyChain: any[]): Promise<boolean> {
  try {
    const currentDutyIndex = dutyChain.findIndex((d: any) => d === duty);
    if (currentDutyIndex === -1) {
      console.error('Current duty not found in duty chain');
      return false;
    }
    if (currentDutyIndex === 0) {
      // No previous duty, so default to true
      return true;
    }
    const prevDuty = dutyChain[currentDutyIndex - 1];
    return await isLastDutyInDutyPeriod(prevDuty, dutyChain);
  } catch (error) {
    console.error('Error in isFirstDutyInDutyPeriod:', error);
    return false;
  }
}

/**
 *
 * @param duty
 * @param dutyChain
 * @returns
 * This function checks if the given duty is the last duty in a duty period according to FDP and rest rules.
 */
export async function isLastDutyInDutyPeriod(duty: any, dutyChain: any[]): Promise<boolean> {
  try {
    //console.log('dutyChain---------------:', dutyChain);
    const currentDutyIndex = dutyChain.findIndex((d: any) => d === duty);
    if (currentDutyIndex === -1) {
      console.error('Current duty not found in duty chain');
      return false;
    }

    const isFdpResult = await isFdp(duty, dutyChain);
    
    if (isFdpResult) {

      // Get next duty in chain
      const nextDuty = currentDutyIndex < dutyChain.length - 1 ? dutyChain[currentDutyIndex + 1] : null;


     
      // restTime between this duty and next
      let restTimeVal: string | null = null;
      if (nextDuty) {
        restTimeVal = await restTime(duty, nextDuty);
      }

      // If restTime >= 10:00, return true
      if (restTimeVal !== null) {
        const [h, m] = restTimeVal.split(':').map(Number);
        const restMinutes = h * 60 + m;
        if (restMinutes >= 600) {
          return true;
        }
      }
      // If next duty is not FDP, or no next duty, return true
      if (!nextDuty) {
        return true;
      }
      const isNextFdp = await isFdp(nextDuty, dutyChain);
      if (!isNextFdp) {
        return true;
      }
      // Otherwise, not last in duty period
      return false;
    } else {
      return true;
    }
  } catch (error) {
    console.error('Error in isLastDutyInDutyPeriod:', error);
    return false;
  }
}

/**
 * Returns the end UTC for a duty period, using the next duty's end UTC if not last in period.
 * Implements:
 *   if not is_last_duty_in_duty_period then next(duty(chain), duty.end_utc) else duty.end_utc
 * @param duty The current duty object
 * @param dutyChain The array of duties (duty period)
 * @returns {Promise<string>} The end UTC string
 */
export async function endUTCInDutyPeriod(duty: any, dutyChain: any[]): Promise<string> {
  try {
    const currentDutyIndex = dutyChain.findIndex((d: any) => d === duty);
    if (currentDutyIndex === -1) {
      console.error('Current duty not found in duty chain');
      return duty?.endUTC || '';
    }
    // Use isLastDutyInDutyPeriod from this file
    const isLast = await isLastDutyInDutyPeriod(duty, dutyChain);
    if (!isLast && currentDutyIndex < dutyChain.length - 1) {
      const nextDuty = dutyChain[currentDutyIndex + 1];
      return nextDuty?.endUTC || duty?.endUTC || '';
    } else {
      return duty?.endUTC || '';
    }
  } catch (error) {
    console.error('Error in endUTCInDutyPeriod:', error);
    return duty?.endUTC || '';
  }
}

/**
 * Checks if a duty is FDP (Flight Duty Period)
 * @param duty - The current duty object
 * @param dutyChain - Array of duties in the chain for checking next/prev duties
 * @returns True if duty qualifies as FDP, false otherwise
 */
export async function isFdp(duty: any, dutyChain: any[]): Promise<boolean> {
  try {
    // Find the index of the current duty in the duty list
    let dutyIndex = dutyChain.findIndex((d: any) => d === duty);
    const previousDuty = dutyIndex > 0 ? dutyChain[dutyIndex - 1] : null;
    const nextDuty = dutyIndex < dutyChain.length - 1 ? dutyChain[dutyIndex + 1] : null;

    const restTimeCal = await restTime(duty, nextDuty);

    // Check if duty is on duty
    const isOnDuty = await isONDuty(duty);
    if (!isOnDuty) {
      return false;
    }

    // Check if duty has active flight
    const hasActiveFlightInDuty = await hasActiveFlight(duty);
    if (hasActiveFlightInDuty) {
      return true;
    }

    // Check standby manual duty break or deadhead conditions
    const isSbyManualBreak = await isSbyManualDutyBreak(duty);
    const hasDeadheadInDuty = await hasDeadhead(duty);

    if (isSbyManualBreak || hasDeadheadInDuty) {
      // Check rest time conditions
      const restTimeVal = nextDuty ? await restTime(duty, nextDuty) : null;
      const restTimeBeforeDutyVal = previousDuty ? await restTimeBeforeDuty(duty, previousDuty) : null;

      let hasShortRestWithActiveFlight = false;

      //Check if rest time < 10:00 and next duty has active flight
      if (restTimeVal !== null && (await convertTimeToMinutes(restTimeVal)) < 600) {
        if (nextDuty && (await hasActiveFlight(nextDuty))) {
          hasShortRestWithActiveFlight = true;
        }
      }

      //Check if rest time before duty < 10:00 and prev duty has active flight
      if (restTimeBeforeDutyVal !== null && (await convertTimeToMinutes(restTimeBeforeDutyVal)) < 600) {
        if (previousDuty && (await hasActiveFlight(previousDuty))) {
          hasShortRestWithActiveFlight = true;
        }
      }

      return hasShortRestWithActiveFlight;
    }

    return false;
  } catch (error) {
    console.error('Error in isFdp function:', error);
    return false;
  }
}

/**
 * Converts time string to minutes
 * @param time - Time string in HH:MM format
 * @returns Time in minutes
 */
async function convertTimeToMinutes(time: string): Promise<number> {
  try {
    const isNegative = time.startsWith('-');
    const [hours, minutes] = time.replace('-', '').split(':').map(Number);
    const totalMinutes = hours * 60 + minutes;
    return isNegative ? -totalMinutes : totalMinutes;
  } catch (error) {
    console.error('Error converting time to minutes:', error);
    return 0;
  }
}

/**
 * Converts minutes to 'HH:mm' format.
 * @param minutes - Number of minutes
 * @returns Time string in 'HH:mm' format
 */
export function convertMinutesToTime(minutes: number): string {
  const isNegative = minutes < 0;
  const absMinutes = Math.abs(minutes);
  const hours = Math.floor(absMinutes / 60);
  const mins = absMinutes % 60;
  const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  return isNegative ? `-${timeStr}` : timeStr;
}

export function privatelyTradedDtPart(duty: any) {
  return null;
}

export const minDutyForNetReductionSkj = 300; // 5:00 hr val in min
export const netDutyReductionFlightDutySkj = 120; // 2:00 hr val in min
export const netDutyReductionGroundDutySkj = 60; // 1:00 hr val in min

/**
 *
 * @param duty
 * @param startDate -- overTime7CalendarDaysStart
 * @param endDate -- overTime7CalendarDaysEnd
 * @returns
 * Calculates net reduction SKJ OMA16 for a duty within a given interval.
 * Returns reduction in minutes (number).
 */
export async function netReductionSkjOma16(duty: any, startDate: string, endDate: string): Promise<number> {
  // Convert dates to Date objects for comparison
  const dutyStart = new Date(duty.startUTC);
  const dutyEnd = new Date(duty.endUTC);
  const intervalStart = new Date(startDate);
  const intervalEnd = new Date(endDate);

  // Duty fully within interval
  if (dutyStart >= intervalStart && dutyEnd <= intervalEnd) {
    // Check for active flight with sufficient block time
    for (const leg of duty.Leg) {
      if (leg.isActiveFlight) {
        return netDutyReductionFlightDutySkj;
      }
    }
    // Check for ground duty with sufficient time
    for (const leg of duty.Leg) {
      if (!(isFlightDutyInLeg(leg) || (await isStandByInLeg(leg)))) {
        return netDutyReductionGroundDutySkj;
      }
    }
    return 0;
  } else {
    // Check for active flight with sufficient overlap
    for (const leg of duty.Leg) {
      if (leg.isActiveFlight && overlap(leg.startUTC, leg.endUTC, startDate, endDate) > minDutyForNetReductionSkj) {
        return netDutyReductionFlightDutySkj;
      }
    }
    // Check for ground duty with sufficient overlap
    for (const leg of duty.Leg) {
      if (!(isFlightDutyInLeg(leg) || (await isStandByInLeg(leg))) && overlap(duty.startUTC, duty.endUTC, startDate, endDate) > minDutyForNetReductionSkj) {
        return netDutyReductionGroundDutySkj;
      }
    }
    return 0;
  }
}

/**
 * 
 * @param leg 
 * @returns 
 * Placeholder function, always returns 0
 */
export function timeInLeg(leg: any) {
  return 0;
}

/**
 * 
 * @param leg 
 * @returns 
 * Placeholder function, always returns 0
 */

export function isFlightDutyInLeg(leg: any) {
  return 0;
}

/**
 *
 * @param duty
 * @returns
 * True if all legs have group 'SBY'
 */
export async function isStandByInLeg(leg: any) {
  if (!leg || !leg.activityCode) return false;
  const group = await getGroupActivityMasterById(leg.activityCode);
  return group === 'SBY';
}


/**
 * Calculates duty period time
 * @param duty - The duty object
 * @param dutyChain - Array of duties in the chain
 * @returns Time difference in minutes, or null
 */
export async function dutyPeriodTime(duty: any, dutyChain: any[]): Promise<number | null> {
  try {
    // Get duty period start UTC directly from duty object
    const startUtcStr = duty?.dutyPeriodStartUTC;
    if (!startUtcStr) {
      return null;
    }
    
    // Get duty period end UTC directly from duty object
    const endUtcStr = duty?.dutyPeriodEndUTC;
    if (!endUtcStr) {
      return null;
    }
    
    // Parse dates and calculate difference in minutes
    const startUtc = new Date(startUtcStr);
    const endUtc = new Date(endUtcStr);
    const diffMinutes = (endUtc.getTime() - startUtc.getTime()) / (1000 * 60);
    
    return diffMinutes;
  } catch (error) {
    console.error('Error in dutyPeriodTime:', error);
    return null;
  }
}

/**
 * Gets the duty period CO end UTC (checkout end time for the last leg)
 * 
 * @param duty - The current duty
 * @param dutyChain - Array of duties in the chain
 * @param referencedData - Reference data for lookups
 * @returns The CO end UTC for the duty period, or null
 */
export async function dutyPeriodCoEndUTC(duty: any, dutyChain: any[], referencedData: any): Promise<Date | null> {
  try {
    const isLast = await isLastDutyInDutyPeriod(duty, dutyChain);
    const currentDutyIndex = dutyChain.findIndex((d: any) => d === duty);

    if (isLast) {
      // Last duty in duty period - get CO end from last leg in current duty
      return await getLastLegCoEndUTC(duty, referencedData);
    } else {
      // Not last duty - get CO end from last leg in next duty
      if (currentDutyIndex < dutyChain.length - 1) {
        const nextDuty = dutyChain[currentDutyIndex + 1];
        return await getLastLegCoEndUTC(nextDuty, referencedData);
      }
      return null;
    }
  } catch (error) {
    console.error('Error in dutyPeriodCoEndUTC:', error);
    return null;
  }
}

/**
 * Gets the last leg from a duty and returns its co_end_utc (arrival + checkout)
 * 
 * @param duty - The duty object
 * @param referencedData - Reference data for lookups
 * @returns The co_end_utc of the last leg, or null
 */
export async function getLastLegCoEndUTC(duty: any, referencedData: any): Promise<Date | null> {
  try {
    if (!duty || !Array.isArray(duty.Leg) || duty.Leg.length === 0) {
      return null;
    }

    // Get the last leg
    const lastLeg = duty.Leg[duty.Leg.length - 1];
    
    // Get arrival time - prefer ATA (actual) over STA (scheduled)
    const arrivalTimeStr = lastLeg?.actualArrivalTimeUTC || lastLeg?.scheduledArrivalTimeUTC || lastLeg?.scheduledEndTimeUTC;
    if (!arrivalTimeStr) {
      return null;
    }
    
    const arrivalTime = new Date(arrivalTimeStr);
    
    // Get checkout time and add to arrival
    const checkOutTimeStr = lastLeg?.checkOutTime;
    if (!checkOutTimeStr) {
      // If no checkout time, return just the arrival time
      return arrivalTime;
    }
    
    // Parse checkout time (format: "HH:MM" or minutes)
    const checkOutMs = durationToMinutes(checkOutTimeStr) * 60 * 1000;
    
    return new Date(arrivalTime.getTime() + checkOutMs);
  } catch (error) {
    console.error('Error in getLastLegCoEndUTC:', error);
    return null;
  }
}

/**
 * Gets the duty period CI start UTC
 * 
 * @param duty - The current duty
 * @param dutyChain - Array of duties in the chain
 * @param referencedData - Reference data for lookups
 * @returns The CI start UTC for the duty period, or null
 */
export async function dutyPeriodCiStartUTC(duty: any, dutyChain: any[], referencedData: any): Promise<Date | null> {
  try {
    const isFirst = await isFirstDutyInDutyPeriod(duty, dutyChain);

    if (isFirst) {
      // First duty in duty period - get CI start from first leg with check-in in current duty
      const result = await getFirstLegWithCheckInCiStartUTC(duty, referencedData);
      return result;
    } else {
      // Not first duty - get CI start from first leg with check-in in previous duty
      const currentDutyIndex = dutyChain.findIndex((d: any) => d === duty);
      if (currentDutyIndex > 0) {
        const prevDuty = dutyChain[currentDutyIndex - 1];
        return await getFirstLegWithCheckInCiStartUTC(prevDuty, referencedData);
      }
      return null;
    }
  } catch (error) {
    console.error('Error in dutyPeriodCiStartUTC:', error);
    return null;
  }
}


/**
 * Calculates duty salary hours without temp CC callout
 * 
 * @param duty - The current duty
 * @param dutyChain - Array of duties in the chain
 * @param referencedData - Reference data for lookups
 * @returns Duty salary hours in minutes, or null if not home standby with callout
 */
export async function dutySalaryHrsNoTempCcCallout(duty: any, dutyChain: any[], referencedData: any): Promise<number | null> {
  try {
    const isHomeStandbyCallout = await isHomeStandbyWithCallout(duty, dutyChain);
    
    if (!isHomeStandbyCallout) {
      return null; // void_reltime
    }
    
    // Get standby salary hours callout
    const sbySalaryHrs = await sbySalaryHrsCallout(duty, dutyChain);
    if (sbySalaryHrs === null) {
      return null;
    }
    
    // Get active duty time callout
    const activeDutyTime = await activeDutyTimeCallout(duty, dutyChain, referencedData);
    if (activeDutyTime === null) {
      return null;
    }
    
    // Calculate sum
    const sum = sbySalaryHrs + activeDutyTime;
    
    // Return max of sum and lower limit (6:00 = 360 minutes)
    return Math.max(sum, lowerLimitHours);
  } catch (error) {
    console.error('Error in dutySalaryHrsNoTempCcCallout:', error);
    return null;
  }
}


/**
 * 
 * @param duty - The current duty
 * @param dutyChain - Array of duties in the chain
 * @param referencedData - Reference data for lookups
 * @returns Corrected duty time in minutes, or null
 */
export async function dutyTimeCorrected(duty: any, dutyChain: any[], referencedData: any): Promise<number | null> {
  try {
    // Check if home standby with callout
    const isHomeStandbyCallout = await isHomeStandbyWithCallout(duty, dutyChain);
    // Check if duty is standby at home
    const isStandbyHome = await isStandByAtHome(duty);
    
    if (isHomeStandbyCallout) {
      console.log('isHomeStandbyCallout');
      // Return duty salary hours without temp CC callout
      return await dutySalaryHrsNoTempCcCallout(duty, dutyChain, referencedData);
    } else if (isStandbyHome) {
      console.log('isStandbyHome');
      // Return lower limit hours (6:00 = 360 minutes)
      return lowerLimitHours;
    } else {
      console.log('dutyPeriodTime');
      // Default case - return duty period time
      return await dutyPeriodTime(duty, dutyChain);
    }
  } catch (error) {
    console.error('Error in dutyTimeCorrected:', error);
    return null;
  }
}

/**
 * @param duty - The current duty
 * @param dutyChain - Array of duties in the chain
 * @param referencedData - Reference data for lookups
 * @returns Salary hours in minutes, or null
 */
export async function dpSalaryHrsNKFSNKCCTemp(duty: any, dutyChain: any[], referencedData: any): Promise<number | null> {
  try {
    const corrected = await dutyTimeCorrected(duty, dutyChain, referencedData);
    if (corrected === null) return null;

    // dutyTimeAcclimPeriod returns milliseconds — convert to minutes
    const acclimMs = await dutyTimeAcclimPeriod(duty, dutyChain);
    const acclimMinutes = acclimMs / (1000 * 60);

    return corrected - acclimMinutes / splitDutyRestSalaryReductionCont;
  } catch (error) {
    console.error('Error in dpSalaryHrsNKFSNKCCTemp:', error);
    return null;
  }
}


function legIsCourse(leg: any, referencedData: any): boolean {
  const code = leg?.activityCode;
  if (!code || !referencedData?.activityMaster) return false;
  const group = referencedData.activityMaster[code]?.group || null;
  return group === "COD";
}


function dutyIsCourse(duty: any, referencedData: any): boolean {
  if (!duty || !Array.isArray(duty.Leg) || duty.Leg.length === 0) return false;
  return duty.Leg.every((leg: any) => legIsCourse(leg, referencedData));
}


function hasAcQln(crew: any, date: string | Date, acType: string): boolean {
  if (!crew || !Array.isArray(crew.validQualifications)) return false;
  const checkDate = new Date(date).getTime();
  return crew.validQualifications.some((q: any) => {
    if (!q.qualification?.includes(acType)) return false;
    const from = new Date(q.validFrom).getTime();
    const to = new Date(q.validTo).getTime();
    return checkDate >= from && checkDate <= to;
  });
}


function getLastFlown(duty: any): Date | null {
  if (!Array.isArray(duty?.Leg) || duty.Leg.length === 0) return null;
  const raw = duty.Leg[0]?.lastFlown;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}


export function IsInitialCourseDuty(crew: any, activity: any, duty: any, referencedData: any): boolean {
  try {
    if (!duty || !crew || !Array.isArray(crew.validQualifications) || !referencedData?.activityMaster) {
      return false;
    }

    const isCourse = dutyIsCourse(duty, referencedData);
    if (!isCourse) return false;

    const lastFlown = getLastFlown(duty);
    if (!lastFlown) return false;

    const BASELINE_DATE = new Date("1986-01-01T00:00:00Z").getTime();
    const dutyStart = new Date(duty.startUTC).getTime();
    const lastFlownTime = lastFlown.getTime();

    const hasFF = hasAcQln(crew, duty.startUTC, "FF");

    return (lastFlownTime === dutyStart && hasFF) || lastFlownTime === BASELINE_DATE;
  } catch (error) {
    console.error("Error in IsInitialCourseDuty:", error);
    return false;
  }
}

/**
 *
 * Returns salary hours (in minutes) for temporary crew if:
 *   - crew is temporary at the duty homebase start date
 *   - duty is on duty
 *   - duty is NOT an initial course
 *   - duty is the last duty in the duty period
 * Otherwise returns 0.
 *
 */
export async function tempCrewHoursPerDutyPeriodNKFSNKCCTE(
  crew: any,
  duty: any,
  dutyChain: any[],
  referencedData: any,
): Promise<number> {
  try {
    const dutyStartHb = duty.startHomeBase ?? duty.startUTC;
    const isTemporaryAtDate = isCrewTemporaryOnDate(crew, referencedData, dutyStartHb);
    if (!isTemporaryAtDate) {
      console.log(`tempCrewHoursPerDutyPeriodNKFSNKCCTE: crew ${crew.crewId} not temporary at ${dutyStartHb}`);
      return 0;
    }

    const onDuty = await isONDuty(duty);
    if (!onDuty) {
      console.log(`tempCrewHoursPerDutyPeriodNKFSNKCCTE: duty ${duty.id} is not on duty`);
      return 0;
    }

    const isInitialCourse = IsInitialCourseDuty(crew, null, duty, referencedData);
    if (isInitialCourse) {
      console.log(`tempCrewHoursPerDutyPeriodNKFSNKCCTE: duty ${duty.id} is initial course`);
      return 0;
    }

    const isLastDuty = await isLastDutyInDutyPeriod(duty, dutyChain);
    if (!isLastDuty) {
      console.log(`tempCrewHoursPerDutyPeriodNKFSNKCCTE: duty ${duty.id} is not last duty in duty period`);
      return 0;
    }

    const dpSalaryHrs = await dpSalaryHrsNKFSNKCCTemp(duty, dutyChain, referencedData);
    const result = Math.max(dpSalaryHrs ?? 0, lowerLimitHoursPerDPNKFSNKCCTempCrew);
    console.log(`tempCrewHoursPerDutyPeriodNKFSNKCCTE: crew ${crew.crewId}, duty ${duty.id}, dpSalaryHrs=${dpSalaryHrs}, result=${result}`);
    return result;
  } catch (error) {
    console.error('Error in tempCrewHoursPerDutyPeriodNKFSNKCCTE:', error);
    return 0;
  }
}



/**
 * Checks if a duty is a blank day by verifying that any leg in the duty has activity group "BL".
 */
export async function isBlankDayDuty(duty: any): Promise<boolean> {
  if (!duty || !Array.isArray(duty.Leg) || duty.Leg.length === 0) return false;
  for (const leg of duty.Leg) {
    if (await isBlankDay(leg)) return true;
  }
  return false;
}

/**
 *
 * @param crew - The crew object
 * @param date - The reference date (AbsTime)
 * @param dutyChain - Flattened array of all duties across the roster
 * @param referencedData - Reference data for lookups
 * @param homeBase - Crew homebase (for out-station calculation)
 * @returns Total temp crew hours in minutes, or 0 if conditions not met
 */
export async function tempCrewHoursNKFSNKCCSumTE(
  crew: any,
  date: string | Date,
  dutyChain: any[],
  referencedData: any,
  homeBase: any,
): Promise<number> {
  try {
    const refDate = new Date(date);
    const isNKFSNK = isNKFSNKOnDate(crew.crewId, referencedData, refDate);
    const isExceptionNO = isExceptionSZSSKNO(crew, referencedData, date);

    const rank = crew.validRank?.[0]?.rank ?? '';
    const cabinCrew = isCabinCrew(rank);
    const crewIsTemporaryOnDateFlag = isCrewTemporaryOnDate(crew, referencedData, refDate);

    if (!((isNKFSNK || isExceptionNO) && cabinCrew && crewIsTemporaryOnDateFlag)) {
      return 0;
    }

    // --- Sum across qualifying duties ---
    const datePlus24h = new Date(refDate.getTime() + 24 * 60 * 60 * 1000);
    let totalHrs = 0;

    for (let i = 0; i < dutyChain.length; i++) {
      const duty = dutyChain[i];

      const dpEndHb = new Date(duty.dutyPeriodEndHB ?? duty.dutyPeriodEndUTC);
      if (dpEndHb < refDate) continue;

      const dutyEndHb = new Date(duty.endHomeBase ?? duty.endUTC);
      if (dutyEndHb >= datePlus24h) continue;

      if (await isBlankDayDuty(duty)) continue;

      // Accumulate temp_crew_hours_per_duty_period_NKF_SNK_CC_TE
      totalHrs += await tempCrewHoursPerDutyPeriodNKFSNKCCTE(crew, duty, dutyChain, referencedData);
    }

    for (let i = dutyChain.length - 1; i >= 0; i--) {
      const duty = dutyChain[i];
      const dpEndHb = new Date(duty.dutyPeriodEndHB ?? duty.dutyPeriodEndUTC);
      const dutyEndHb = new Date(duty.endHomeBase ?? duty.endUTC);
      if (dpEndHb >= refDate && dutyEndHb < datePlus24h && !(await isBlankDayDuty(duty))) {
        const nextDuty = i < dutyChain.length - 1 ? dutyChain[i + 1] : null;
        totalHrs += await outStationLongRestPeriodDutyHrs(duty, nextDuty, homeBase, referencedData);
        break;
      }
    }

    return totalHrs;
  } catch (error) {
    console.error('Error in tempCrewHoursNKFSNKCCSumTE:', error);
    return 0;
  }
}
/** Develop Branch Code Ends   */