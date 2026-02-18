// Structured, hardcoded data for Daewoo Express Pakistan voice agent
// This file intentionally does not use any external data sources or databases.

const busData = {
  routes: {
    "Lahore-Islamabad": {
      departureTimes: ["08:00 AM", "11:00 AM", "02:00 PM", "05:00 PM", "09:00 PM"],
      ticketPrice: "3,500 PKR",
      duration: "4.5 hours",
    },
    "Lahore-Multan": {
      departureTimes: ["07:00 AM", "10:00 AM", "01:00 PM", "04:00 PM", "08:00 PM"],
      ticketPrice: "2,800 PKR",
      duration: "4 hours",
    },
    "Karachi-Lahore": {
      departureTimes: ["06:00 AM", "12:00 PM", "06:00 PM", "11:00 PM"],
      ticketPrice: "7,500 PKR",
      duration: "18 hours (overnight options available)",
    },
    "Islamabad-Peshawar": {
      departureTimes: ["09:00 AM", "12:00 PM", "03:00 PM", "06:00 PM", "09:00 PM"],
      ticketPrice: "2,200 PKR",
      duration: "2.5 hours",
    },
  },
  bookingInstructions:
    "You can book Daewoo Express tickets through the official website, mobile app, call center, or by visiting any Daewoo terminal ticket counter. For online booking, select your origin, destination, travel date, and preferred departure time, then provide passenger details. Complete payment using available digital methods to confirm your booking.",
  confirmationInstructions:
    "After successful booking, you will receive an SMS and, if applicable, an email with your ticket details and booking reference number. Please arrive at the terminal at least 30 minutes before departure with your CNIC and reference number. At the counter or gate, show your reference so the staff can verify and issue your boarding pass.",
  terminalInfo:
    "Major Daewoo Express terminals include Lahore Kalma Chowk, Lahore Thokar, Islamabad Faizabad, Rawalpindi Pirwadahi, Multan General Bus Stand, Karachi Sohrab Goth, and Peshawar terminal near Motorway Interchange. Exact terminal addresses and contact numbers are available on the official Daewoo Express website and can also be confirmed at your nearest terminal.",
};

module.exports = busData;

